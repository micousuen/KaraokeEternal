import { db } from '../lib/Database.js'
import { loadVocalSeparationConfig } from './VocalSeparationConfig.js'

export type MediaQueueReadiness = 'missing' | 'processing' | 'ready'

interface ReadinessRow {
  audioTrackCount: number | null
  isManagedDownload: number
  pathData: string
  scriptReady: number | null
}

export const managedDownloadsRequireScript = loadVocalSeparationConfig().scripting.enabled

export function getMediaQueueReadiness (mediaId: number): MediaQueueReadiness {
  const row = db.get<ReadinessRow>(`
    SELECT media.isManagedDownload, paths.data AS pathData,
      audioTrackAnalysis.audioTrackCount, audioTrackAnalysis.scriptReady
    FROM media
      INNER JOIN paths USING (pathId)
      LEFT JOIN audioTrackAnalysis USING (mediaId)
    WHERE mediaId = ?
  `, [mediaId])
  if (!row) return 'missing'
  return isReady(row) ? 'ready' : 'processing'
}

export function getSongQueueReadiness (songId: number): MediaQueueReadiness {
  const rows = db.all<ReadinessRow>(`
    SELECT media.isManagedDownload, paths.data AS pathData,
      audioTrackAnalysis.audioTrackCount, audioTrackAnalysis.scriptReady
    FROM media
      INNER JOIN paths USING (pathId)
      LEFT JOIN audioTrackAnalysis USING (mediaId)
    WHERE songId = ?
  `, [songId])
  if (!rows.length) return 'missing'
  return rows.some(isReady) ? 'ready' : 'processing'
}

function isReady (row: ReadinessRow): boolean {
  if (!row.isManagedDownload && !isManagedDownloadPath(row.pathData)) return true
  return (row.audioTrackCount ?? 0) >= 2 && (!managedDownloadsRequireScript || row.scriptReady === 1)
}

function isManagedDownloadPath (data: string): boolean {
  try {
    return !!JSON.parse(data).isManagedDownloadPath
  } catch {
    return false
  }
}
