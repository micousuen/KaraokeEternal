import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from 'store/store'
import type { QueueItem } from 'shared/types'

const getActiveQueue = createSelector(
  [
    (state: RootState) => state.queue.result,
    (state: RootState) => state.queue.entities,
    (state: RootState) => state.status.history,
  ],
  (result, entities, history) => {
    return {
      result: result.filter((id) => {
        const item = entities[id]
        return (!('isPlayed' in item) || !item.isPlayed) && !history.includes(id)
      }),
      entities: entities as Record<number, QueueItem>,
    }
  },
)

export default getActiveQueue
