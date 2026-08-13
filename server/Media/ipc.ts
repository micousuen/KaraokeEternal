import Media from './Media.js'
import Library from '../Library/Library.js'
import { scheduleAudioTrackAnalysis } from './AudioTrackAnalysis.js'
import { scheduleMediaMetadataAnalysis } from './MediaMetadataAnalysis.js'
import { LIBRARY_SCAN_BATCH, MEDIA_ADD, MEDIA_ANALYZE, MEDIA_CLEANUP, MEDIA_REMOVE, MEDIA_UPDATE } from '../../shared/actionTypes.js'

/**
 * IPC action handlers
 */
export default function (io, suppressWatcher) {
  const pendingSongIds = new Set<number>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined

  const queueLiveUpdate = (songId) => {
    if (!Number.isInteger(songId)) return
    pendingSongIds.add(songId)
    Library.cache.version = null

    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = undefined
        const songIds = [...pendingSongIds]
        pendingSongIds.clear()

        while (songIds.length) {
          io.emit('action', {
            type: LIBRARY_SCAN_BATCH,
            payload: Library.getScanBatch(songIds.splice(0, 999)),
          })
        }
      }, 1000)
    }
  }

  return {
    [MEDIA_ANALYZE]: ({ payload }) => {
      for (const item of Array.isArray(payload) ? payload : [payload]) {
        const onAnalysisComplete = (analyzedMediaId) => {
          const media = Media.search({ mediaId: analyzedMediaId })
          queueLiveUpdate(media.entities[analyzedMediaId]?.songId)
        }
        const schedule = (mediaId, source) => {
          scheduleMediaMetadataAnalysis({ mediaId, source, onComplete: onAnalysisComplete })
          if (!item.isVideo) return
          scheduleAudioTrackAnalysis(mediaId, source, {
            pathId: item.pathId,
            isManagedDownload: !!item.isManagedDownload,
            onSeparationComplete: schedule,
            onSourceReplacing: suppressWatcher,
            onAnalysisComplete,
          })
        }
        schedule(item.mediaId, item.source)
      }
    },
    [MEDIA_ADD]: ({ payload }) => {
      const mediaId = Media.add(payload)
      queueLiveUpdate(payload.songId)
      return mediaId
    },
    [MEDIA_CLEANUP]: Media.cleanup,
    [MEDIA_REMOVE]: ({ payload }) => Media.remove(payload),
    [MEDIA_UPDATE]: ({ payload }) => {
      Media.update(payload)
      queueLiveUpdate(payload.songId)
    },
  }
}
