import childProcess from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import getLogger from '../lib/Log.js'
import { db } from '../lib/Database.js'

const execFile = promisify(childProcess.execFile)
const log = getLogger('VocalSeparation')
const downloadsPath = process.env.KES_PATH_DOWNLOADS || '/media/downloads'
const configPath = process.env.KES_PATH_VOCAL_SEPARATION_CONFIG || path.resolve('assets/config/vocal-separation.yaml')
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
}

interface Job {
  mediaId: number
  pathId: number
  source: string
  onComplete: () => void
  onSourceReplacing: (pathId: number) => void
}

export interface VocalSeparationStatus {
  enabled: boolean
  queuedSongs: number
  currentSong: string | null
  currentStartedAt: number | null
  currentProgress: number | null
  completedSongs: number
  averageSpeed: number | null
  lastError: string | null
  recent: SeparationHistoryItem[]
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
let completedSongs = 0
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
  scheduled.add(job.mediaId)
  if (prioritize) queue.unshift(job)
  else queue.push(job)
  log.info('Queued mediaId=%s for vocal separation%s', job.mediaId, prioritize ? ' (priority)' : '')
  emitStatus()
  void drain()
}

export function getVocalSeparationStatus (): VocalSeparationStatus {
  return {
    enabled: config.enabled,
    queuedSongs: queue.length,
    currentSong: currentJob ? path.basename(currentJob.source, path.extname(currentJob.source)) : null,
    currentStartedAt: currentStartedAt || null,
    currentProgress: currentProgress ?? null,
    completedSongs,
    averageSpeed: processingSeconds > 0 ? processedAudioSeconds / processingSeconds : null,
    lastError,
    recent: getRecentHistory(),
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
      lastError = null
      markStarted(job)
      emitStatus()
      try {
        const audioSeconds = await separate(job)
        const elapsedSeconds = (Date.now() - currentStartedAt) / 1000
        completedSongs++
        processedAudioSeconds += audioSeconds
        processingSeconds += elapsedSeconds
        markFinished(job, 'succeeded', audioSeconds, elapsedSeconds, null)
        job.onComplete()
      } catch (err) {
        lastError = errorMessage(err)
        const elapsedSeconds = currentStartedAt ? (Date.now() - currentStartedAt) / 1000 : 0
        markFinished(job, 'failed', null, elapsedSeconds, lastError)
        log.warn('Could not generate instrumental for mediaId=%s: %s', job.mediaId, lastError)
      } finally {
        scheduled.delete(job.mediaId)
        currentJob = undefined
        currentStartedAt = undefined
        currentProgress = undefined
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

function getRecentHistory (): SeparationHistoryItem[] {
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
  log.info('Generating instrumental for mediaId=%s: %s', job.mediaId, job.source)

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

    const stems = (await fsPromises.readdir(workDir))
      .filter(file => /_\((?!Vocals\))[^)]+\)_.*\.flac$/i.test(file))
      .map(file => path.join(workDir, file))
    if (!stems.length) throw new Error('HTDemucs produced no non-vocal stems')

    const instrumental = path.join(workDir, 'instrumental.m4a')
    setProgress(92)
    await execFile(ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      ...stems.flatMap(file => ['-i', file]),
      '-filter_complex', `amix=inputs=${stems.length}:duration=longest:normalize=0,alimiter=limit=0.99`,
      '-c:a', 'aac', '-b:a', config.outputBitrate, instrumental,
    ])

    const remuxed = path.join(workDir, `remuxed${path.extname(job.source)}`)
    setProgress(96)
    await execFile(ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', job.source, '-i', instrumental,
      '-map', '0', '-map', '1:a:0', '-c', 'copy',
      '-metadata:s:a:1', 'title=Instrumental', '-disposition:a:1', '0',
      ...(path.extname(job.source).toLowerCase() === '.mp4' ? ['-movflags', '+faststart'] : []),
      remuxed,
    ])
    setProgress(98)
    if (await audioTrackCount(remuxed) !== 2) throw new Error('Remuxed video does not contain exactly two audio tracks')

    const currentStats = await fsPromises.stat(job.source)
    if (currentStats.size !== initialStats.size || currentStats.mtimeMs !== initialStats.mtimeMs) {
      throw new Error('Source changed while vocal separation was running')
    }
    await fsPromises.copyFile(remuxed, replacement)
    await fsPromises.chmod(replacement, initialStats.mode)
    job.onSourceReplacing(job.pathId)
    await fsPromises.rename(replacement, job.source)
    setProgress(100)
    log.info('Added generated instrumental as A2 for mediaId=%s', job.mediaId)
    return audioSeconds
  } finally {
    // Success, inference failure, FFmpeg failure, and validation failure all clean up here.
    await Promise.all([
      fsPromises.rm(workDir, { recursive: true, force: true }),
      fsPromises.rm(replacement, { force: true }),
    ])
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
    const handleOutput = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-10 * 1024 * 1024)
      for (const match of chunk.toString().matchAll(/(\d{1,3})(?:\.\d+)?%/g)) {
        const separatorPct = Math.min(100, Number(match[1]))
        setProgress(Math.round(separatorPct * 0.9))
      }
    }
    child.stdout.on('data', handleOutput)
    child.stderr.on('data', handleOutput)
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(Object.assign(new Error(`audio-separator exited with code ${code}`), { stderr: output }))
    })
  })
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
  return value
}

function errorMessage (err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  if (!('stderr' in err) || typeof err.stderr !== 'string') return err.message
  const lines = err.stderr
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const useful = [...lines].reverse().find(line =>
    /error|exception|failed|unable|unsupported|invalid|no such|permission denied/i.test(line)
    && !/separation produced no output files|see errors above/i.test(line),
  )
  return useful || lines.at(-1) || err.message
}
