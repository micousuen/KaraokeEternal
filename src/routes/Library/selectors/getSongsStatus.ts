import { RootState } from 'store/store'
import { createSelector, type Selector } from '@reduxjs/toolkit'
import { ensureState } from 'redux-optimistic-ui'

const getQueue = (state: RootState) => ensureState(state.queue)
const getCurrentQueueId = (state: RootState) => state.status.isAtQueueEnd ? undefined : state.status.queueId
const getPlayerHistoryJSON = (state: RootState) => state.status.historyJSON

type SongsStatus = {
  played: number[]
  upcoming: number[]
  current: number | undefined
}

const getSongsStatus: Selector<RootState, SongsStatus> = createSelector(
  [getQueue, getCurrentQueueId, getPlayerHistoryJSON],
  (queue, curId, historyJSON): SongsStatus => {
    const history = JSON.parse(historyJSON)
    const played: number[] = []
    const upcoming: number[] = []

    queue.result.forEach((queueId) => {
      const queueItem = queue.entities[queueId]
      if (('isPlayed' in queueItem && queueItem.isPlayed) || history.includes(queueId)) {
        played.push(queueItem.songId)
      } else if (queueId !== curId) {
        upcoming.push(queueItem.songId)
      }
    })

    return { played, upcoming, current: queue.entities[curId]?.songId }
  },
)

export default getSongsStatus
