import childProcess from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import getLogger from '../lib/Log.js'
import { db } from '../lib/Database.js'
import whisperxWorker, { type WhisperXSettings } from './WhisperXWorker.js'

const execFileAsync = promisify(childProcess.execFile)
const log = getLogger('VocalSeparation')
const downloadsPath = process.env.KES_PATH_DOWNLOADS || '/media/downloads'
const configPath = process.env.KES_PATH_VOCAL_SEPARATION_CONFIG || path.resolve('config/vocal-separation.yaml')
const tempRoot = path.join(downloadsPath, '.karaoke-eternal-separation')
const modelRoot = path.join(downloadsPath, '.karaoke-eternal-models')
const numbaCacheRoot = path.join(modelRoot, '.numba-cache')
const separatorPath = process.env.KES_PATH_AUDIO_SEPARATOR || 'audio-separator'
const ffmpegPath = process.env.KES_PATH_FFMPEG || 'ffmpeg'
const ffprobePath = process.env.KES_PATH_FFPROBE || 'ffprobe'

interface SeparationConfig {
  enabled: boolean
  model: string
  segmentSeconds: number
  overlap: number
  shifts: number
  outputBitrate: string
  scripting: {
    enabled: boolean
    model: string
    language?: string
    vadOnset?: number
    beamSize?: number
    initialPrompt?: string
  }
}

interface Job {
  mediaId: number
  pathId: number
  source: string
  generateInstrumental: boolean
  needsScript?: boolean
  sourceReplaced?: boolean
  prioritized?: boolean
  onComplete?: () => void
  onSourceReplacing: (pathId: number) => void
}

export interface VocalSeparationStatus {
  enabled: boolean
  modelsMounted: boolean
  modelsLoading: boolean
  queuedSongs: number
  currentSong: string | null
  currentStartedAt: number | null
  currentProgress: number | null
  currentStage: 'separating' | 'scripting' | null
  currentTasks: ProcessingTask[]
  completedSongs: number
  averageSpeed: number | null
  lastError: string | null
  recent: SeparationHistoryItem[]
  queued: Array<{ mediaId: number, song: string, tasks: ProcessingTask[] }>
  completedThisRun: SeparationHistoryItem[]
}

export interface ProcessingTask {
  type: 'separation' | 'instrumental' | 'scripting'
  label: string
  status: 'queued' | 'processing' | 'completed'
  progress: number | null
}

export interface SeparationHistoryItem {
  mediaId: number
  song: string
  status: 'processing' | 'succeeded' | 'failed'
  attempts: number
  startedAt: number | null
  completedAt: number | null
  audioSeconds: number | null
  processingSeconds: number | null
  error: string | null
}

const config = loadConfig()
const queue: Job[] = []
const scheduled = new Set<number>()
let active = false
let currentJob: Job | undefined
let currentStartedAt: number | undefined
let currentProgress: number | undefined
let currentStage: 'separating' | 'scripting' | undefined
let completedSongs = 0
const completedThisRun = new Set<number>()
let processedAudioSeconds = 0
let processingSeconds = 0
let lastError: string | null = null
let publishStatus: ((status: VocalSeparationStatus) => void) | undefined

// Remove job data abandoned by an unclean shutdown. Model files live elsewhere.
const startupCleanup = fsPromises.rm(tempRoot, { recursive: true, force: true }).catch((err) => {
  log.warn('Could not clear vocal separation temp folder: %s', err.message)
})

export function scheduleVocalSeparation (job: Job, prioritize = false): void {
  if (!config.enabled || scheduled.has(job.mediaId)) return
  job.needsScript = config.scripting.enabled && !fs.existsSync(scriptPath(job.source))
  if (!job.generateInstrumental && !job.needsScript) return
  job.prioritized = prioritize
  scheduled.add(job.mediaId)
  if (prioritize) {
    let lastPriority = -1
    for (let index = 0; index < queue.length; index++) {
      if (queue[index].prioritized) lastPriority = index
    }
    queue.splice(lastPriority + 1, 0, job)
  } else queue.push(job)
  log.info('Queued mediaId=%s for vocal separation%s', job.mediaId, prioritize ? ' (priority)' : '')
  emitStatus()
  void drain()
}

export async function mountWhisperXModels (): Promise<void> {
  const mounting = whisperxWorker.mount(whisperXSettings())
  emitStatus()
  try {
    await mounting
  } finally {
    emitStatus()
  }
}

export async function unmountWhisperXModels (): Promise<void> {
  await whisperxWorker.unmount()
  emitStatus()
}

export function getVocalSeparationStatus (): VocalSeparationStatus {
  const history = getHistory()
  return {
    enabled: config.enabled,
    modelsMounted: whisperxWorker.mounted,
    modelsLoading: whisperxWorker.loading,
    queuedSongs: queue.length,
    currentSong: currentJob ? path.basename(currentJob.source, path.extname(currentJob.source)) : null,
    currentStartedAt: currentStartedAt || null,
    currentProgress: currentProgress ?? null,
    currentStage: currentStage || null,
    currentTasks: currentJob ? tasksForJob(currentJob, currentStage, currentProgress) : [],
    completedSongs,
    averageSpeed: processingSeconds > 0 ? processedAudioSeconds / processingSeconds : null,
    lastError,
    recent: history,
    queued: queue.map(job => ({
      mediaId: job.mediaId,
      song: path.basename(job.source, path.extname(job.source)),
      tasks: tasksForJob(job),
    })),
    completedThisRun: history.filter(item => completedThisRun.has(item.mediaId)),
  }
}

export function setVocalSeparationStatusPublisher (
  publisher: (status: VocalSeparationStatus) => void,
): void {
  publishStatus = publisher
  emitStatus()
}

async function drain (): Promise<void> {
  if (active) return
  active = true
  try {
    await startupCleanup
    while (queue.length) {
      const job = queue.shift()!
      currentJob = job
      currentStartedAt = Date.now()
      currentProgress = 0
      currentStage = 'separating'
      lastError = null
      markStarted(job)
      emitStatus()
      try {
        const audioSeconds = await separate(job)
        const elapsedSeconds = (Date.now() - currentStartedAt) / 1000
        completedSongs++
        completedThisRun.add(job.mediaId)
        processedAudioSeconds += audioSeconds
        processingSeconds += elapsedSeconds
        markFinished(job, 'succeeded', audioSeconds, elapsedSeconds, null)
        job.onComplete?.()
        job.sourceReplaced = false
      } catch (err) {
        lastError = errorMessage(err, currentStage)
        const elapsedSeconds = currentStartedAt ? (Date.now() - currentStartedAt) / 1000 : 0
        markFinished(job, 'failed', null, elapsedSeconds, lastError)
        // The instrumental replacement may have succeeded before scripting
        // failed. Re-analyze that changed source even though the overall job failed.
        if (job.sourceReplaced) job.onComplete?.()
        job.sourceReplaced = false
        log.warn('Could not generate instrumental for mediaId=%s: %s', job.mediaId, lastError)
      } finally {
        scheduled.delete(job.mediaId)
        currentJob = undefined
        currentStartedAt = undefined
        currentProgress = undefined
        currentStage = undefined
        emitStatus()
      }
    }
  } finally {
    active = false
  }
}

function markStarted (job: Job): void {
  db.run(`
    INSERT INTO vocalSeparationHistory
      (mediaId, source, model, status, attempts, startedAt, completedAt, audioSeconds, processingSeconds, error)
    VALUES (?, ?, ?, 'processing', 1, ?, NULL, NULL, NULL, NULL)
    ON CONFLICT(mediaId) DO UPDATE SET
      source = excluded.source,
      model = excluded.model,
      status = 'processing',
      attempts = vocalSeparationHistory.attempts + 1,
      startedAt = excluded.startedAt,
      completedAt = NULL,
      audioSeconds = NULL,
      processingSeconds = NULL,
      error = NULL
  `, [job.mediaId, job.source, config.model, Math.round(Date.now() / 1000)])
}

function markFinished (
  job: Job,
  status: 'succeeded' | 'failed',
  audioSeconds: number | null,
  elapsedSeconds: number,
  error: string | null,
): void {
  db.run(`
    UPDATE vocalSeparationHistory
    SET status = ?, completedAt = ?, audioSeconds = ?, processingSeconds = ?, error = ?
    WHERE mediaId = ?
  `, [status, Math.round(Date.now() / 1000), audioSeconds, elapsedSeconds, error, job.mediaId])
}

function getHistory (): SeparationHistoryItem[] {
  return db.all<{
    mediaId: number
    source: string
    status: 'processing' | 'succeeded' | 'failed'
    attempts: number
    startedAt: number | null
    completedAt: number | null
    audioSeconds: number | null
    processingSeconds: number | null
    error: string | null
  }>(`
    SELECT mediaId, source, status, attempts, startedAt, completedAt,
      audioSeconds, processingSeconds, error
    FROM vocalSeparationHistory
    ORDER BY COALESCE(completedAt, startedAt) DESC
  `).map(row => ({
    ...row,
    song: path.basename(row.source, path.extname(row.source)),
  }))
}

async function separate (job: Job): Promise<number> {
  const initialStats = await fsPromises.stat(job.source)
  const audioSeconds = await mediaDuration(job.source)
  const workDir = path.join(tempRoot, String(job.mediaId))
  const replacement = `${job.source}.instrumental.partial`
  await fsPromises.rm(workDir, { recursive: true, force: true })
  await fsPromises.rm(replacement, { force: true })
  await fsPromises.mkdir(workDir, { recursive: true })
  await fsPromises.mkdir(modelRoot, { recursive: true })
  await fsPromises.mkdir(numbaCacheRoot, { recursive: true })
  log.info('Separating vocals for mediaId=%s: %s', job.mediaId, job.source)

  try {
    // Normalize input decoding through FFmpeg. audio-separator's librosa/audioread
    // fallback cannot reliably open every video container that FFmpeg supports.
    const separatorInput = path.join(workDir, 'input.wav')
    await execFile(ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', job.source, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', '44100',
      '-c:a', 'pcm_s16le', separatorInput,
    ])
    setProgress(2)
    await runSeparator([
      separatorInput,
      '--model_filename', config.model,
      '--model_file_dir', modelRoot,
      '--output_dir', workDir,
      '--output_format', 'FLAC',
      '--demucs_segment_size', String(config.segmentSeconds),
      '--demucs_shifts', String(config.shifts),
      '--demucs_overlap', String(config.overlap),
    ])

    const files = await fsPromises.readdir(workDir)
    const vocalName = files.find(file => /_\(Vocals\)_.*\.flac$/i.test(file))
    if (!vocalName) throw new Error('HTDemucs produced no vocal stem')
    const vocal = path.join(workDir, vocalName)

    const stems = files
      .filter(file => /_\((?!Vocals\))[^)]+\)_.*\.flac$/i.test(file))
      .map(file => path.join(workDir, file))
    if (job.generateInstrumental && !stems.length) throw new Error('HTDemucs produced no non-vocal stems')

    if (job.generateInstrumental) {
      const instrumental = path.join(workDir, 'instrumental.m4a')
      setProgress(72)
      await execFile(ffmpegPath, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        ...stems.flatMap(file => ['-i', file]),
        '-filter_complex', `amix=inputs=${stems.length}:duration=longest:normalize=0,alimiter=limit=0.99`,
        '-c:a', 'aac', '-b:a', config.outputBitrate, instrumental,
      ])

      const remuxed = path.join(workDir, `remuxed${path.extname(job.source)}`)
      setProgress(76)
      await execFile(ffmpegPath, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', job.source, '-i', instrumental,
        '-map', '0', '-map', '1:a:0', '-c', 'copy',
        '-metadata:s:a:1', 'title=Instrumental', '-disposition:a:1', '0',
        ...(path.extname(job.source).toLowerCase() === '.mp4' ? ['-movflags', '+faststart'] : []),
        remuxed,
      ])
      if (await audioTrackCount(remuxed) !== 2) throw new Error('Remuxed video does not contain exactly two audio tracks')

      const currentStats = await fsPromises.stat(job.source)
      if (currentStats.size !== initialStats.size || currentStats.mtimeMs !== initialStats.mtimeMs) {
        throw new Error('Source changed while vocal separation was running')
      }
      await fsPromises.copyFile(remuxed, replacement)
      await fsPromises.chmod(replacement, initialStats.mode)
      job.onSourceReplacing(job.pathId)
      await fsPromises.rename(replacement, job.source)
      job.sourceReplaced = true
      log.info('Added generated instrumental as A2 for mediaId=%s', job.mediaId)
    }

    if (job.needsScript && !fs.existsSync(scriptPath(job.source))) {
      currentStage = 'scripting'
      currentProgress = 0
      emitStatus()
      // Give WhisperX a simple, decoder-independent audio input. This also
      // matches the sample rate required by its Silero VAD implementation.
      const scriptingInput = path.join(workDir, 'vocals-for-whisperx.wav')
      await execFile(ffmpegPath, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', vocal, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', scriptingInput,
      ])
      const { srt } = await runWhisperX(scriptingInput, workDir)
      await fsPromises.copyFile(srt, `${scriptPath(job.source)}.partial`)
      await fsPromises.rename(`${scriptPath(job.source)}.partial`, scriptPath(job.source))
      db.run('UPDATE audioTrackAnalysis SET scriptReady = 1 WHERE mediaId = ?', [job.mediaId])
      emitStatus()
      log.info('Generated script for mediaId=%s: %s', job.mediaId, scriptPath(job.source))
    }
    setProgress(100)
    return audioSeconds
  } finally {
    // Success, inference failure, FFmpeg failure, and validation failure all clean up here.
    await Promise.all([
      fsPromises.rm(workDir, { recursive: true, force: true }),
      fsPromises.rm(replacement, { force: true }),
    ])
  }
}

function tasksForJob (
  job: Job,
  stage?: 'separating' | 'scripting',
  progress?: number,
): ProcessingTask[] {
  const separationDone = stage === 'scripting'
  const instrumentalActive = stage === 'separating' && (progress || 0) >= 70
  const tasks: ProcessingTask[] = [{
    type: 'separation',
    label: 'Separate vocals',
    status: separationDone ? 'completed' : stage === 'separating' ? 'processing' : 'queued',
    progress: separationDone ? 100 : stage === 'separating' ? Math.min(100, Math.round((progress || 0) / 0.7)) : 0,
  }]
  if (job.generateInstrumental) tasks.push({
    type: 'instrumental',
    label: 'Add instrumental track',
    status: separationDone ? 'completed' : instrumentalActive ? 'processing' : 'queued',
    progress: separationDone
      ? 100
      : instrumentalActive
        ? Math.min(100, Math.round(((progress || 70) - 70) / 0.06))
        : 0,
  })
  if (job.needsScript) tasks.push({
    type: 'scripting',
    label: 'Create SRT script (WhisperX CPU)',
    status: stage === 'scripting' ? 'processing' : 'queued',
    progress: stage === 'scripting' ? progress ?? 0 : 0,
  })
  return tasks
}

function scriptPath (source: string): string {
  return path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.srt`)
}

async function runWhisperX (vocal: string, outputDir: string): Promise<{ language: string, srt: string }> {
  // The worker mounts itself on demand and stays alive for subsequent songs,
  // avoiding repeated ASR/VAD model startup.
  const result = await whisperxWorker.transcribe(vocal, outputDir, whisperXSettings(), (progress) => {
    setProgress(Math.min(99, Math.round(progress)))
  }, () => {
    emitStatus()
  })
  setProgress(100)
  return result
}

function whisperXSettings (): WhisperXSettings {
  return {
    model: config.scripting.model,
    language: config.scripting.language,
    vadOnset: config.scripting.vadOnset ?? 0.35,
    beamSize: config.scripting.beamSize ?? 8,
    initialPrompt: config.scripting.initialPrompt,
  }
}

async function mediaDuration (filename: string): Promise<number> {
  const { stdout } = await execFile(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filename,
  ])
  const duration = Number.parseFloat(stdout)
  return Number.isFinite(duration) ? duration : 0
}

async function runSeparator (args: string[]): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await runSeparatorOnce(args)
      return
    } catch (err) {
      if (attempt === 2 || !isNoChildProcessError(err)) throw err
      log.warn('audio-separator process wait failed with ECHILD; retrying once')
    }
  }
}

async function runSeparatorOnce (args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = childProcess.spawn(separatorPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Numba otherwise tries to cache librosa JIT functions beside the
        // read-only Python installation under /opt/audio-separator.
        NUMBA_CACHE_DIR: numbaCacheRoot,
      },
    })
    let output = ''
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      if (err) reject(Object.assign(err, { stderr: output }))
      else resolve()
    }
    const handleOutput = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-10 * 1024 * 1024)
      for (const match of chunk.toString().matchAll(/(\d{1,3})(?:\.\d+)?%/g)) {
        const separatorPct = Math.min(100, Number(match[1]))
        setProgress(Math.round(separatorPct * 0.7))
      }
    }
    child.stdout.on('data', handleOutput)
    child.stderr.on('data', handleOutput)
    child.on('error', finish)
    child.on('close', (code) => {
      if (code === 0) finish()
      else finish(new Error(`audio-separator exited with code ${code}`))
    })
  })
}

function isNoChildProcessError (err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return ('code' in err && err.code === 'ECHILD') || /no child processes/i.test(`${err.message}\n${'stderr' in err ? err.stderr : ''}`)
}

async function execFile (
  command: string,
  args: string[],
): Promise<{ stdout: string, stderr: string }> {
  try {
    return await execFileAsync(command, args, { encoding: 'utf8' })
  } catch (err) {
    if (!isNoChildProcessError(err)) throw err
    log.warn('%s process wait failed with ECHILD; retrying once', path.basename(command))
    return execFileAsync(command, args, { encoding: 'utf8' })
  }
}

function setProgress (progress: number): void {
  if (currentProgress !== undefined && progress <= currentProgress) return
  currentProgress = progress
  emitStatus()
}

function emitStatus (): void {
  publishStatus?.(getVocalSeparationStatus())
}

async function audioTrackCount (filename: string): Promise<number> {
  const { stdout } = await execFile(ffprobePath, [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filename,
  ])
  return stdout.split(/\r?\n/).filter(Boolean).length
}

function loadConfig (): SeparationConfig {
  const value = parse(fs.readFileSync(configPath, 'utf8')) as SeparationConfig
  if (typeof value.enabled !== 'boolean' || typeof value.model !== 'string' || !value.model
    || !Number.isFinite(value.segmentSeconds) || !Number.isFinite(value.overlap)
    || !Number.isInteger(value.shifts) || typeof value.outputBitrate !== 'string') {
    throw new Error(`${configPath}: invalid vocal separation configuration`)
  }
  if (!value.scripting || typeof value.scripting.enabled !== 'boolean'
    || typeof value.scripting.model !== 'string' || !value.scripting.model) {
    throw new Error(`${configPath}: invalid scripting configuration`)
  }
  const invalidVadOnset = value.scripting.vadOnset !== undefined
    && (!Number.isFinite(value.scripting.vadOnset) || value.scripting.vadOnset <= 0 || value.scripting.vadOnset >= 1)
  const invalidBeamSize = value.scripting.beamSize !== undefined
    && (!Number.isInteger(value.scripting.beamSize) || value.scripting.beamSize < 1)
  const invalidInitialPrompt = value.scripting.initialPrompt !== undefined
    && typeof value.scripting.initialPrompt !== 'string'
  if (invalidVadOnset || invalidBeamSize || invalidInitialPrompt) {
    throw new Error(`${configPath}: invalid scripting tuning configuration`)
  }
  return value
}

function errorMessage (err: unknown, stage?: 'separating' | 'scripting'): string {
  const stageLabel = stage === 'scripting' ? 'Scripting' : 'Separation'
  if (!(err instanceof Error)) return `[${stageLabel}] ${String(err)}`

  const output = 'stderr' in err && typeof err.stderr === 'string' ? err.stderr : ''
  const lines = output
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const tail = lines.slice(-80).join('\n').slice(-12_000)
  const headline = `[${stageLabel}] ${err.message}`
  return tail && tail !== err.message ? `${headline}\n${tail}` : headline
}
