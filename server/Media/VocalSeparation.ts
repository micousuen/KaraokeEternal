import childProcess from 'node:child_process'
import fs, { type Stats } from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import getLogger from '../lib/Log.js'
import { db } from '../lib/Database.js'
import whisperxWorker, { type WhisperXSettings } from './WhisperXWorker.js'

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
  instrumentalVocalMix: number
  scripting: {
    enabled: boolean
    model: string
    language?: string
    vadOnset?: number
    vadChunkSeconds?: number
    beamSize?: number
    maxLineWidth?: number
    maxLineCount?: number
    minLineWidth?: number
    initialPrompt?: string
  }
}

interface Job {
  mediaId: number
  pathId: number
  source: string
  vocalTrack: 0 | 1
  runSeparation: boolean
  generateInstrumental: boolean
  allowScript: boolean
  forceScript?: boolean
  replaceInstrumental?: boolean
  needsScript?: boolean
  sourceReplaced?: boolean
  prioritized?: boolean
  onComplete?: () => void
  onSourceReplacing: (pathId: number) => void
}

export interface VocalSeparationStatus {
  enabled: boolean
  isPaused: boolean
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
let paused = false
let currentJob: Job | undefined
let currentStartedAt: number | undefined
let currentProgress: number | undefined
let currentStage: 'separating' | 'scripting' | undefined
let separationFinished = false
let currentInstrumentalProgress: number | undefined
let currentScriptingProgress: number | undefined
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

export function scheduleVocalSeparation (job: Job, prioritize = false): boolean {
  if (!config.enabled || scheduled.has(job.mediaId)) return false
  job.needsScript = job.allowScript && config.scripting.enabled
    && (!!job.forceScript || !fs.existsSync(scriptPath(job.source)))
  // Separation is an intermediate step, not a standalone deliverable. Once
  // both downstream outputs already exist, there is nothing left to process.
  if (!job.generateInstrumental && !job.needsScript) return false
  job.runSeparation = job.runSeparation && (job.generateInstrumental || job.needsScript)
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
  return true
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

export function pauseVocalSeparation (): void {
  paused = true
  emitStatus()
}

export function resumeVocalSeparation (): void {
  if (!paused) return
  paused = false
  emitStatus()
  void drain()
}

export function getVocalSeparationStatus (): VocalSeparationStatus {
  const history = getHistory()
  return {
    enabled: config.enabled,
    isPaused: paused,
    modelsMounted: whisperxWorker.mounted,
    modelsLoading: whisperxWorker.loading,
    queuedSongs: queue.length,
    currentSong: currentJob ? path.basename(currentJob.source, path.extname(currentJob.source)) : null,
    currentStartedAt: currentStartedAt || null,
    currentProgress: currentProgress ?? null,
    currentStage: currentStage || null,
    currentTasks: currentJob ? tasksForJob(currentJob, true) : [],
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
    while (queue.length && !paused) {
      const job = queue.shift()!
      currentJob = job
      currentStartedAt = Date.now()
      currentProgress = 0
      currentStage = job.runSeparation ? 'separating' : 'scripting'
      separationFinished = !job.runSeparation
      currentInstrumentalProgress = undefined
      currentScriptingProgress = !job.runSeparation && job.needsScript ? 0 : undefined
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
        lastError = errorMessage(err, processingStage(err) || currentStage)
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
        separationFinished = false
        currentInstrumentalProgress = undefined
        currentScriptingProgress = undefined
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
  log.info('%s for mediaId=%s from A%s: %s', job.runSeparation ? 'Separating vocals' : 'Creating script', job.mediaId, job.vocalTrack + 1, job.source)

  try {
    let vocal: string | undefined
    let stems: string[] = []
    if (job.runSeparation) {
      // Normalize input decoding through FFmpeg. audio-separator's librosa/audioread
      // fallback cannot reliably open every video container that FFmpeg supports.
      const separatorInput = path.join(workDir, 'input.wav')
      await execFile(ffmpegPath, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', job.source, '-map', `0:a:${job.vocalTrack}`, '-vn', '-ac', '2', '-ar', '44100',
        '-c:a', 'pcm_s16le', separatorInput,
      ])
      setProgress(3)
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
      vocal = path.join(workDir, vocalName)

      stems = files
        .filter(file => /_\((?!Vocals\))[^)]+\)_.*\.flac$/i.test(file))
        .map(file => path.join(workDir, file))
      if (job.generateInstrumental && !stems.length) throw new Error('HTDemucs produced no non-vocal stems')
      separationFinished = true
      setProgress(100)
      emitStatus()
    }

    const finishingTasks: Array<Promise<void>> = []
    if (job.generateInstrumental) {
      if (!vocal) throw new Error('HTDemucs produced no vocal stem')
      finishingTasks.push(generateInstrumental(job, vocal, stems, workDir, replacement, initialStats)
        .catch((err) => { throw markProcessingStage(err, 'separating') }))
    }
    if (job.needsScript && (job.forceScript || !fs.existsSync(scriptPath(job.source)))) {
      finishingTasks.push(generateScript(job, vocal, workDir)
        .catch((err) => { throw markProcessingStage(err, 'scripting') }))
    }

    // Both branches only read the separated vocal stem, so run them together.
    // Wait for every branch even after a failure because cleanup below owns
    // their shared work directory.
    const results = await Promise.allSettled(finishingTasks)
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
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

async function generateInstrumental (
  job: Job,
  vocal: string,
  stems: string[],
  workDir: string,
  replacement: string,
  initialStats: Stats,
): Promise<void> {
  currentInstrumentalProgress = 0
  emitStatus()
  const instrumental = path.join(workDir, 'instrumental.m4a')
  const mixInputs = [...stems, vocal]
  const mixWeights = [...stems.map(() => '1'), String(config.instrumentalVocalMix)].join(' ')
  setInstrumentalProgress(10)
  await execFile(ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    ...mixInputs.flatMap(file => ['-i', file]),
    '-filter_complex', `amix=inputs=${mixInputs.length}:weights='${mixWeights}':duration=longest:normalize=0,alimiter=limit=0.99`,
    '-c:a', 'aac', '-b:a', config.outputBitrate, instrumental,
  ])

  const remuxed = path.join(workDir, `remuxed${path.extname(job.source)}`)
  setInstrumentalProgress(35)
  const videoCodec = await sourceVideoCodec(job.source)
  const videoOptions = videoCodec && !isPassthroughVideoCodec(videoCodec)
    ? [
        '-c:v:0', 'libx264',
        '-preset:v:0', process.env.KES_TRANSCODE_PRESET || 'veryfast',
        '-crf:v:0', process.env.KES_TRANSCODE_CRF || '20',
        '-pix_fmt:v:0', 'yuv420p',
      ]
    : []
  if (videoOptions.length) {
    log.info('Transcoding %s video to H.264 while adding instrumental track for mediaId=%s', videoCodec, job.mediaId)
  }
  const streamMaps = job.replaceInstrumental
    ? ['-map', '0', '-map', '-0:a', '-map', `0:a:${job.vocalTrack}`, '-map', '1:a:0']
    : ['-map', '0', '-map', '1:a:0']
  setInstrumentalProgress(45)
  await execFile(ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', job.source, '-i', instrumental,
    ...streamMaps, '-c', 'copy', ...videoOptions,
    '-metadata:s:a:1', 'title=Instrumental', '-disposition:a:1', '0',
    ...(path.extname(job.source).toLowerCase() === '.mp4' ? ['-movflags', '+faststart'] : []),
    remuxed,
  ])
  setInstrumentalProgress(90)
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
  setInstrumentalProgress(100)
  log.info('%s generated instrumental as A2 for mediaId=%s', job.replaceInstrumental ? 'Replaced' : 'Added', job.mediaId)
}

async function generateScript (job: Job, vocal: string | undefined, workDir: string): Promise<void> {
  currentStage = 'scripting'
  currentScriptingProgress = 0
  currentProgress = 0
  emitStatus()
  // Give WhisperX a simple, decoder-independent audio input. This also
  // matches the sample rate required by its Silero VAD implementation.
  const scriptingInput = path.join(workDir, 'vocals-for-whisperx.wav')
  await execFile(ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', vocal || job.source,
    ...(vocal ? [] : ['-map', `0:a:${job.vocalTrack}`]),
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', scriptingInput,
  ])
  const { srt } = await runWhisperX(scriptingInput, workDir)
  await fsPromises.copyFile(srt, `${scriptPath(job.source)}.partial`)
  await fsPromises.rename(`${scriptPath(job.source)}.partial`, scriptPath(job.source))
  db.run('UPDATE audioTrackAnalysis SET scriptReady = 1 WHERE mediaId = ?', [job.mediaId])
  currentScriptingProgress = 100
  currentProgress = 100
  emitStatus()
  log.info('Generated script for mediaId=%s: %s', job.mediaId, scriptPath(job.source))
}

function tasksForJob (
  job: Job,
  live = false,
): ProcessingTask[] {
  const tasks: ProcessingTask[] = []
  if (job.runSeparation) tasks.push({
    type: 'separation',
    label: 'Separate vocals',
    status: live ? separationFinished ? 'completed' : 'processing' : 'queued',
    progress: live ? separationFinished ? 100 : currentStage === 'separating' ? currentProgress ?? 0 : 0 : 0,
  })
  if (job.generateInstrumental) tasks.push({
    type: 'instrumental',
    label: 'Add instrumental track',
    status: !live || currentInstrumentalProgress === undefined
      ? 'queued'
      : currentInstrumentalProgress >= 100 ? 'completed' : 'processing',
    progress: live ? currentInstrumentalProgress ?? 0 : 0,
  })
  if (job.needsScript) tasks.push({
    type: 'scripting',
    label: 'Create SRT script (WhisperX CPU)',
    status: !live || currentScriptingProgress === undefined
      ? 'queued'
      : currentScriptingProgress >= 100 ? 'completed' : 'processing',
    progress: live ? currentScriptingProgress ?? 0 : 0,
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
    setScriptingProgress(Math.min(99, Math.round(progress)))
  }, () => {
    emitStatus()
  })
  return result
}

function whisperXSettings (): WhisperXSettings {
  return {
    model: config.scripting.model,
    language: config.scripting.language,
    vadOnset: config.scripting.vadOnset ?? 0.35,
    vadChunkSeconds: config.scripting.vadChunkSeconds ?? 15,
    beamSize: config.scripting.beamSize ?? 8,
    maxLineWidth: config.scripting.maxLineWidth ?? 36,
    maxLineCount: config.scripting.maxLineCount ?? 2,
    minLineWidth: config.scripting.minLineWidth ?? 12,
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
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await runSeparatorOnce(args)
      return
    } catch (err) {
      if (attempt === 3 || !isNoChildProcessError(err)) throw err
      log.warn('audio-separator process wait failed with ECHILD; retrying (%s/3)', attempt + 1)
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
        setProgress(separatorPct)
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
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await runCommand(command, args)
    } catch (err) {
      if (attempt === 3 || !isNoChildProcessError(err)) throw err
      log.warn('%s process wait failed with ECHILD; retrying (%s/3)', path.basename(command), attempt + 1)
    }
  }
  throw new Error(`${path.basename(command)} did not start`)
}

function runCommand (command: string, args: string[]): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      const output = { stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }
      if (err) reject(Object.assign(err, output))
      else resolve(output)
    }
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', finish)
    child.on('close', (code, signal) => {
      if (code === 0) finish()
      else finish(new Error(`${path.basename(command)} exited with ${code === null ? `signal ${signal || 'unknown'}` : `code ${code}`}`))
    })
  })
}

function setProgress (progress: number): void {
  if (currentProgress !== undefined && progress <= currentProgress) return
  currentProgress = progress
  emitStatus()
}

function setInstrumentalProgress (progress: number): void {
  if (currentInstrumentalProgress !== undefined && progress <= currentInstrumentalProgress) return
  currentInstrumentalProgress = progress
  if (currentScriptingProgress === undefined) {
    currentStage = 'separating'
    currentProgress = progress
  }
  emitStatus()
}

function setScriptingProgress (progress: number): void {
  if (currentScriptingProgress !== undefined && progress <= currentScriptingProgress) return
  currentScriptingProgress = progress
  currentStage = 'scripting'
  currentProgress = progress
  emitStatus()
}

function markProcessingStage (err: unknown, stage: 'separating' | 'scripting'): Error {
  const error = err instanceof Error ? err : new Error(String(err))
  return Object.assign(error, { processingStage: stage })
}

function processingStage (err: unknown): 'separating' | 'scripting' | undefined {
  if (!(err instanceof Error) || !('processingStage' in err)) return undefined
  return err.processingStage === 'separating' || err.processingStage === 'scripting'
    ? err.processingStage
    : undefined
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

async function sourceVideoCodec (filename: string): Promise<string | null> {
  const { stdout } = await execFile(ffprobePath, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name',
    '-of', 'default=nw=1:nk=1', filename,
  ])
  return stdout.trim().toLowerCase() || null
}

function isPassthroughVideoCodec (codec: string): boolean {
  return codec === 'h264' || codec === 'hevc' || codec === 'h265'
}

function loadConfig (): SeparationConfig {
  const value = parse(fs.readFileSync(configPath, 'utf8')) as SeparationConfig
  if (typeof value.enabled !== 'boolean' || typeof value.model !== 'string' || !value.model
    || !Number.isFinite(value.segmentSeconds) || !Number.isFinite(value.overlap)
    || !Number.isInteger(value.shifts) || typeof value.outputBitrate !== 'string'
    || !Number.isFinite(value.instrumentalVocalMix) || value.instrumentalVocalMix < 0 || value.instrumentalVocalMix > 1) {
    throw new Error(`${configPath}: invalid vocal separation configuration`)
  }
  if (!value.scripting || typeof value.scripting.enabled !== 'boolean'
    || typeof value.scripting.model !== 'string' || !value.scripting.model) {
    throw new Error(`${configPath}: invalid scripting configuration`)
  }
  const invalidVadOnset = value.scripting.vadOnset !== undefined
    && (!Number.isFinite(value.scripting.vadOnset) || value.scripting.vadOnset <= 0 || value.scripting.vadOnset >= 1)
  const invalidVadChunkSeconds = value.scripting.vadChunkSeconds !== undefined
    && (!Number.isFinite(value.scripting.vadChunkSeconds) || value.scripting.vadChunkSeconds < 5 || value.scripting.vadChunkSeconds > 30)
  const invalidBeamSize = value.scripting.beamSize !== undefined
    && (!Number.isInteger(value.scripting.beamSize) || value.scripting.beamSize < 1)
  const invalidMaxLineWidth = value.scripting.maxLineWidth !== undefined
    && (!Number.isInteger(value.scripting.maxLineWidth) || value.scripting.maxLineWidth < 10)
  const invalidMaxLineCount = value.scripting.maxLineCount !== undefined
    && (!Number.isInteger(value.scripting.maxLineCount) || value.scripting.maxLineCount < 1)
  const invalidMinLineWidth = value.scripting.minLineWidth !== undefined
    && (!Number.isInteger(value.scripting.minLineWidth) || value.scripting.minLineWidth < 1)
  const invalidInitialPrompt = value.scripting.initialPrompt !== undefined
    && typeof value.scripting.initialPrompt !== 'string'
  if (invalidVadOnset || invalidVadChunkSeconds || invalidBeamSize || invalidMaxLineWidth || invalidMaxLineCount || invalidMinLineWidth || invalidInitialPrompt) {
    throw new Error(`${configPath}: invalid scripting tuning configuration`)
  }
  return value
}

function errorMessage (err: unknown, stage?: 'separating' | 'scripting'): string {
  const stageLabel = stage === 'scripting' ? 'Scripting' : 'Separation'
  if (!(err instanceof Error)) return `[${stageLabel}] ${String(err)}`

  const output = 'stderr' in err && typeof err.stderr === 'string' ? err.stderr : ''
  const lines = output
    // ANSI terminal color escape sequence.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const tail = lines.slice(-80).join('\n').slice(-12_000)
  const headline = `[${stageLabel}] ${err.message}`
  return tail && tail !== err.message ? `${headline}\n${tail}` : headline
}
