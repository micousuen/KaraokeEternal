import { RootState } from 'store/store'
import { createSelector, type Selector } from '@reduxjs/toolkit'

const getQueue = (state: RootState) => state.queue
const getCurrentQueueId = (state: RootState) => state.status.isAtQueueEnd ? undefined : state.status.queueId
const getPlayerHistory = (state: RootState) => state.status.history

type SongsStatus = {
  played: ReadonlySet<number>
  queued: ReadonlySet<number>
  current: number | undefined
}

const getSongsStatus: Selector<RootState, SongsStatus> = createSelector(
  [getQueue, getCurrentQueueId, getPlayerHistory],
  (queue, curId, history): SongsStatus => {
    const played = new Set<number>()
    const queued = new Set<number>()

    queue.result.forEach((queueId) => {
      const queueItem = queue.entities[queueId]
      if (('isPlayed' in queueItem && queueItem.isPlayed) || history.includes(queueId)) {
        played.add(queueItem.songId)
      } else {
        queued.add(queueItem.songId)
      }
    })

    return { played, queued, current: queue.entities[curId]?.songId }
  },
)

export default getSongsStatus
