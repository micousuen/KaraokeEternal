import { useEffect } from 'react'
import HttpApi from 'lib/HttpApi'
import { getSupportedMediaTypes } from '../lib/mediaSupport'
import { getPrecacheMediaIds, type ActiveQueue } from '../lib/playbackQueue'
import type { QueueItem } from 'shared/types'

const mediaApi = new HttpApi('media')
const combinedPlayback = /Web0S|webOS|NetCast/i.test(navigator.userAgent)

export default function useMediaPrecache (
  queue: ActiveQueue,
  current: QueueItem | undefined,
  priority: QueueItem | undefined,
  isPlaying: boolean,
): void {
  useEffect(() => {
    if (!isPlaying || !current) return
    const mediaIds = getPrecacheMediaIds(queue, current, priority)
    if (mediaIds.length) {
      void mediaApi.post('/precache', {
        body: { mediaIds, combinedPlayback, ...getSupportedMediaTypes() },
      }).catch((): void => {})
    }
  }, [current, isPlaying, priority, queue])
}
