import fsPromises from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import type { KtvTrackDetection } from './KtvTrackDetector.js'

export interface AudioTrackAnalysisRecord {
  mediaId: number
  audioTrackCount: number
  ktvTrack: 0 | 1 | null
  confidence: number
  sourceSize: number
  sourceMtimeMs: number
  dateAnalyzed: number
}

interface Job {
  mediaId: number
  source: string
  resolve?: (record: AudioTrackAnalysisRecord) => void
  reject?: (err: Error) => void
}

const log = getLogger('AudioTrackAnalysis')
const queue: Job[] = []
const pending = new Map<number, Promise<AudioTrackAnalysisRecord>>()
let active = false

export function scheduleAudioTrackAnalysis (mediaId: number, source: string): void {
  if (pending.has(mediaId)) return
  let resolveJob: (record: AudioTrackAnalysisRecord) => void
  let rejectJob: (err: Error) => void
  const promise = new Promise<AudioTrackAnalysisRecord>((resolve, reject) => {
    resolveJob = resolve
    rejectJob = reject
  })
  pending.set(mediaId, promise)
  void promise.catch(() => {})
  queue.push({ mediaId, source, resolve: resolveJob!, reject: rejectJob! })
  void drain()
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
  return row.sourceSize === stats.size && row.sourceMtimeMs === stats.mtimeMs ? row : undefined
}

async function analyze (mediaId: number, source: string): Promise<AudioTrackAnalysisRecord> {
  const stats = await fsPromises.stat(source)
  const result = await runClassifier(source)
  const record: AudioTrackAnalysisRecord = {
    mediaId,
    audioTrackCount: result.audioTrackCount,
    ktvTrack: result.ktvTrack,
    confidence: result.confidence,
    sourceSize: stats.size,
    sourceMtimeMs: stats.mtimeMs,
    dateAnalyzed: Math.round(Date.now() / 1000),
  }
  db.run(`
    INSERT INTO audioTrackAnalysis
      (mediaId, audioTrackCount, ktvTrack, confidence, sourceSize, sourceMtimeMs, dateAnalyzed)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mediaId) DO UPDATE SET
      audioTrackCount = excluded.audioTrackCount,
      ktvTrack = excluded.ktvTrack,
      confidence = excluded.confidence,
      sourceSize = excluded.sourceSize,
      sourceMtimeMs = excluded.sourceMtimeMs,
      dateAnalyzed = excluded.dateAnalyzed
  `, [
    record.mediaId,
    record.audioTrackCount,
    record.ktvTrack,
    record.confidence,
    record.sourceSize,
    record.sourceMtimeMs,
    record.dateAnalyzed,
  ])
  log.info('Analyzed mediaId=%s: %s audio track(s), instrumental=%s confidence=%s',
    mediaId,
    record.audioTrackCount,
    record.ktvTrack === null ? 'unknown' : `A${record.ktvTrack + 1}`,
    record.confidence.toFixed(2))
  return record
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
