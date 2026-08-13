import fsPromises from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import type { MetadataResult } from '../Scanner/FileScanner/MetadataWorkerPool.js'

interface AnalysisJob {
  mediaId: number
  source: string
  onComplete?: (mediaId: number) => void
}

interface AnalysisRecord {
  sourceSize: number
  sourceMtimeMs: number
}

const log = getLogger('MediaMetadataAnalysis')
const metadataTimeoutMs = positiveInteger(process.env.KES_METADATA_TIMEOUT_MS, 2 * 60_000)
const queue: AnalysisJob[] = []
const pending = new Set<number>()
let active = false

export function scheduleMediaMetadataAnalysis (job: AnalysisJob): void {
  if (pending.has(job.mediaId)) return
  pending.add(job.mediaId)
  queue.push(job)
  void drain()
}

async function drain (): Promise<void> {
  if (active) return
  active = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      try {
        if (await analyzeMediaMetadataIfStale(job.mediaId, job.source)) job.onComplete?.(job.mediaId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn('Could not analyze technical metadata for mediaId=%s: %s', job.mediaId, message)
      } finally {
        pending.delete(job.mediaId)
      }
    }
  } finally {
    active = false
  }
}

export async function analyzeMediaMetadataIfStale (
  mediaId: number,
  source: string,
  readMetadata: (source: string) => Promise<MetadataResult> = runMetadataWorker,
): Promise<boolean> {
  // Retry within the same job if a watcher-triggering replacement happens
  // while the file is being read. Never mark metadata from old bytes current.
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await fsPromises.stat(source)
    const record = db.get<AnalysisRecord>(
      'SELECT sourceSize, sourceMtimeMs FROM mediaMetadataAnalysis WHERE mediaId = ?',
      [mediaId],
    )
    if (record?.sourceSize === before.size && record.sourceMtimeMs === before.mtimeMs) return false

    const metadata = await readMetadata(source)
    const after = await fsPromises.stat(source)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue

    db.exec('BEGIN IMMEDIATE')
    try {
      const updated = db.run(`
        UPDATE media
        SET duration = ?, rgTrackGain = ?, rgTrackPeak = ?
        WHERE mediaId = ?
      `, [Math.round(metadata.duration), metadata.rgTrackGain, metadata.rgTrackPeak, mediaId])
      if (!updated.changes) {
        db.exec('ROLLBACK')
        return false
      }
      db.run(`
        INSERT INTO mediaMetadataAnalysis (mediaId, sourceSize, sourceMtimeMs, dateAnalyzed)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(mediaId) DO UPDATE SET
          sourceSize = excluded.sourceSize,
          sourceMtimeMs = excluded.sourceMtimeMs,
          dateAnalyzed = excluded.dateAnalyzed
      `, [mediaId, after.size, after.mtimeMs, Math.round(Date.now() / 1000)])
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    log.info('Analyzed technical metadata for mediaId=%s: duration=%ss', mediaId, metadata.duration.toFixed(2))
    return true
  }
  throw new Error('Source changed repeatedly while metadata was being analyzed')
}

function runMetadataWorker (source: string): Promise<MetadataResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../Scanner/FileScanner/metadataWorker.js', import.meta.url), {
      execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
      workerData: { filenameFormat: '' },
    })
    let settled = false
    const timeout = setTimeout(() => finish(new Error(`metadata worker timed out after ${metadataTimeoutMs}ms`)), metadataTimeoutMs)
    timeout.unref()
    const finish = (error?: Error, result?: MetadataResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate()
      if (error) reject(error)
      else resolve(result!)
    }
    worker.once('message', (message) => {
      if (message.ok) finish(undefined, message.result)
      else finish(new Error(message.error))
    })
    worker.once('error', error => finish(error instanceof Error ? error : new Error(String(error))))
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`metadata worker exited without a result (code ${code})`))
    })
    worker.postMessage({
      id: 1,
      input: { file: source, forceMediaRead: true, technicalOnly: true },
    })
  })
}

function positiveInteger (value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
