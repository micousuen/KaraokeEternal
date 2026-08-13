import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import type { KtvTrackDetection } from './KtvTrackDetector.js'
import { scheduleVocalSeparation } from './VocalSeparation.js'
import { planAutomaticMediaProcessing, planForcedMediaProcessing } from './MediaProcessingPolicy.js'

export interface AudioTrackAnalysisRecord {
  mediaId: number
  audioTrackCount: number
  ktvTrack: 0 | 1 | null
  confidence: number
  duration: number
  scriptReady: number
  sourceSize: number
  sourceMtimeMs: number
  dateAnalyzed: number
}

interface Job {
  mediaId: number
  source: string
  pathId?: number
  isManagedDownload?: boolean
  onSeparationComplete?: (mediaId: number, source: string) => void
  onSourceReplacing?: (pathId: number) => void
  onAnalysisComplete?: (mediaId: number) => void
  resolve?: (record: AudioTrackAnalysisRecord) => void
  reject?: (err: Error) => void
}

const log = getLogger('AudioTrackAnalysis')
const queue: Job[] = []
const pending = new Map<number, Promise<AudioTrackAnalysisRecord>>()
let active = false

export function scheduleAudioTrackAnalysis (
  mediaId: number,
  source: string,
  options?: {
    pathId?: number
    isManagedDownload?: boolean
    onSeparationComplete?: (mediaId: number, source: string) => void
    onSourceReplacing?: (pathId: number) => void
    onAnalysisComplete?: (mediaId: number) => void
  },
): void {
  if (pending.has(mediaId)) return
  let resolveJob: (record: AudioTrackAnalysisRecord) => void
  let rejectJob: (err: Error) => void
  const promise = new Promise<AudioTrackAnalysisRecord>((resolve, reject) => {
    resolveJob = resolve
    rejectJob = reject
  })
  pending.set(mediaId, promise)
  void promise.catch(() => {})
  queue.push({ mediaId, source, ...options, resolve: resolveJob!, reject: rejectJob! })
  void drain()
}

export async function forceMediaProcessing (
  mediaId: number,
  pathId: number,
  source: string,
  output: 'instrumental' | 'script',
  onComplete?: () => void,
  onSourceReplacing: (pathId: number) => void = () => {},
): Promise<void> {
  const record = await ensureAudioTrackAnalysis(mediaId, source)
  if (record.audioTrackCount < 1) throw new Error('The selected media has no audio track')

  const plan = planForcedMediaProcessing({
    audioTrackCount: record.audioTrackCount,
    ktvTrack: record.ktvTrack,
    isManagedDownload: false,
  }, output)
  if (!plan.shouldSchedule || plan.vocalTrack === null) throw new Error('The selected media has no usable audio track')
  const queued = scheduleVocalSeparation({
    mediaId,
    pathId,
    source,
    vocalTrack: plan.vocalTrack,
    runSeparation: plan.runSeparation,
    generateInstrumental: plan.generateInstrumental,
    allowScript: plan.allowScript,
    forceScript: plan.forceScript,
    replaceInstrumental: plan.replaceInstrumental,
    onComplete: output === 'instrumental'
      ? () => scheduleAudioTrackAnalysis(mediaId, source, { onAnalysisComplete: onComplete })
      : onComplete,
    onSourceReplacing,
  }, true)

  if (!queued) throw new Error('Media processing is disabled or this song is already queued')
}

export async function ensureAudioTrackAnalysis (
  mediaId: number,
  source: string,
): Promise<AudioTrackAnalysisRecord> {
  const cached = await readCurrent(mediaId, source)
  if (cached) return cached

  const queuedIndex = queue.findIndex(job => job.mediaId === mediaId)
  if (queuedIndex !== -1) {
    const job = queue.splice(queuedIndex, 1)[0]
    queue.unshift(job)
    return pending.get(mediaId)!
  }

  const current = pending.get(mediaId)
  if (current) return current

  const promise = new Promise<AudioTrackAnalysisRecord>((resolve, reject) => {
    queue.unshift({ mediaId, source, resolve, reject })
  })
  pending.set(mediaId, promise)
  void drain()
  return promise
}

async function drain (): Promise<void> {
  if (active) return
  active = true
  try {
    while (queue.length) {
      const job = queue.shift()
      if (!job) continue
      try {
        const cached = await readCurrent(job.mediaId, job.source)
        const record = cached || await analyze(job.mediaId, job.source)
        job.onAnalysisComplete?.(job.mediaId)
        if (job.pathId !== undefined && job.onSeparationComplete) {
          const plan = planAutomaticMediaProcessing({
            audioTrackCount: record.audioTrackCount,
            ktvTrack: record.ktvTrack,
            isManagedDownload: !!job.isManagedDownload,
          })
          if (!plan.shouldSchedule) {
            // Existing dual-track media is classified so playback can select
            // its vocal channel, but it must never enter the processing queue.
            if (plan.vocalTrack === null && (record.audioTrackCount === 1 || job.isManagedDownload)) {
              log.warn('Skipping vocal separation for mediaId=%s: could not identify the vocal track', job.mediaId)
            }
            job.resolve?.(record)
            continue
          }
          scheduleVocalSeparation({
            mediaId: job.mediaId,
            pathId: job.pathId,
            source: job.source,
            // A one-track source must use A1. For a dual-track source, the
            // classifier identifies the karaoke/instrumental track and we
            // separate its opposite vocal/master track.
            vocalTrack: plan.vocalTrack!,
            // A YouTube download still needs an isolated vocal stem for an
            // accurate script. Existing dual-track library files stop after
            // classification, since they already have their own vocal/KTV pair.
            runSeparation: plan.runSeparation,
            generateInstrumental: plan.generateInstrumental,
            // Keep library videos that already have A1/A2 untouched. Downloads
            // are still scripted because their dual tracks may not include one.
            allowScript: plan.allowScript,
            // Refresh the library after script-only work too, so detected
            // language and script availability become visible immediately.
            // If the source was remuxed, the callback also re-analyzes it.
            onComplete: () => job.onSeparationComplete?.(job.mediaId, job.source),
            onSourceReplacing: job.onSourceReplacing,
          }, job.isManagedDownload)
        }
        job.resolve?.(record)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        log.warn('Could not analyze mediaId=%s: %s', job.mediaId, error.message)
        job.reject?.(error)
      } finally {
        pending.delete(job.mediaId)
      }
    }
  } finally {
    active = false
  }
}

async function readCurrent (mediaId: number, source: string): Promise<AudioTrackAnalysisRecord | undefined> {
  const row = db.get<AudioTrackAnalysisRecord>(
    'SELECT * FROM audioTrackAnalysis WHERE mediaId = ?',
    [mediaId],
  )
  if (!row) return undefined
  const stats = await fsPromises.stat(source)
  if (row.sourceSize !== stats.size || row.sourceMtimeMs !== stats.mtimeMs || row.duration <= 0) return undefined
  const scriptReady = Number(fs.existsSync(scriptPath(source)))
  if (row.scriptReady !== scriptReady) {
    row.scriptReady = scriptReady
    db.run('UPDATE audioTrackAnalysis SET scriptReady = ? WHERE mediaId = ?', [scriptReady, mediaId])
  }
  return row
}

async function analyze (mediaId: number, source: string): Promise<AudioTrackAnalysisRecord> {
  const stats = await fsPromises.stat(source)
  const result = await runClassifier(source)
  const record: AudioTrackAnalysisRecord = {
    mediaId,
    audioTrackCount: result.audioTrackCount,
    ktvTrack: result.ktvTrack,
    confidence: result.confidence,
    duration: result.duration,
    scriptReady: Number(fs.existsSync(scriptPath(source))),
    sourceSize: stats.size,
    sourceMtimeMs: stats.mtimeMs,
    dateAnalyzed: Math.round(Date.now() / 1000),
  }
  db.run(`
    INSERT INTO audioTrackAnalysis
      (mediaId, audioTrackCount, ktvTrack, confidence, duration, scriptReady,
       sourceSize, sourceMtimeMs, dateAnalyzed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mediaId) DO UPDATE SET
      audioTrackCount = excluded.audioTrackCount,
      ktvTrack = excluded.ktvTrack,
      confidence = excluded.confidence,
      duration = excluded.duration,
      scriptReady = excluded.scriptReady,
      sourceSize = excluded.sourceSize,
      sourceMtimeMs = excluded.sourceMtimeMs,
      dateAnalyzed = excluded.dateAnalyzed
  `, [
    record.mediaId,
    record.audioTrackCount,
    record.ktvTrack,
    record.confidence,
    record.duration,
    record.scriptReady,
    record.sourceSize,
    record.sourceMtimeMs,
    record.dateAnalyzed,
  ])
  if (record.duration > 0) {
    db.run('UPDATE media SET duration = ? WHERE mediaId = ?', [Math.round(record.duration), mediaId])
  }
  log.info('Analyzed mediaId=%s: %s audio track(s), instrumental=%s confidence=%s',
    mediaId,
    record.audioTrackCount,
    record.ktvTrack === null ? 'unknown' : `A${record.ktvTrack + 1}`,
    record.confidence.toFixed(2))
  return record
}

function scriptPath (source: string): string {
  return path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.srt`)
}

function runClassifier (source: string): Promise<KtvTrackDetection> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audioTrackAnalysisWorker.js', import.meta.url), {
      execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
      workerData: { source },
    })
    let settled = false

    worker.once('message', (message) => {
      settled = true
      if (message.ok) resolve(message.result)
      else reject(new Error(message.error))
    })
    worker.once('error', (err) => {
      settled = true
      reject(err)
    })
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(`classifier worker exited without a result (code ${code})`))
    })
  })
}
