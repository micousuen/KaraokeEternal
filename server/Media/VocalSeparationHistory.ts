import path from 'node:path'
import { db } from '../lib/Database.js'

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
  vadSeconds: number | null
  transcribeSeconds: number | null
  alignSeconds: number | null
}

export interface ScriptTimings {
  vad: number | null
  transcribe: number | null
  align: number | null
}

interface HistoryJob {
  mediaId: number
  source: string
}

export class VocalSeparationHistory {
  markStarted (job: HistoryJob, model: string): void {
    db.run(`
      INSERT INTO vocalSeparationHistory
        (mediaId, source, model, status, attempts, startedAt, completedAt, audioSeconds, processingSeconds, error,
         vadSeconds, transcribeSeconds, alignSeconds)
      VALUES (?, ?, ?, 'processing', 1, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
      ON CONFLICT(mediaId) DO UPDATE SET
        source = excluded.source,
        model = excluded.model,
        status = 'processing',
        attempts = vocalSeparationHistory.attempts + 1,
        startedAt = excluded.startedAt,
        completedAt = NULL,
        audioSeconds = NULL,
        processingSeconds = NULL,
        error = NULL,
        vadSeconds = NULL,
        transcribeSeconds = NULL,
        alignSeconds = NULL
    `, [job.mediaId, job.source, model, Math.round(Date.now() / 1000)])
  }

  markFinished (
    job: HistoryJob,
    status: 'succeeded' | 'failed',
    audioSeconds: number | null,
    elapsedSeconds: number,
    error: string | null,
    timings?: ScriptTimings,
  ): void {
    db.run(`
      UPDATE vocalSeparationHistory
      SET status = ?, completedAt = ?, audioSeconds = ?, processingSeconds = ?, error = ?,
        vadSeconds = ?, transcribeSeconds = ?, alignSeconds = ?
      WHERE mediaId = ?
    `, [
      status, Math.round(Date.now() / 1000), audioSeconds, elapsedSeconds, error,
      timings?.vad ?? null, timings?.transcribe ?? null, timings?.align ?? null,
      job.mediaId,
    ])
  }

  getAll (): SeparationHistoryItem[] {
    return db.all<Omit<SeparationHistoryItem, 'song'> & { source: string }>(`
      SELECT mediaId, source, status, attempts, startedAt, completedAt,
        audioSeconds, processingSeconds, error, vadSeconds, transcribeSeconds, alignSeconds
      FROM vocalSeparationHistory
      ORDER BY COALESCE(completedAt, startedAt) DESC
    `).map(({ source, ...row }) => ({
      ...row,
      song: path.basename(source, path.extname(source)),
    }))
  }
}
