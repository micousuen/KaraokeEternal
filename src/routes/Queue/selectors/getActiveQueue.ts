import { createSelector } from '@reduxjs/toolkit'
import { ensureState } from 'redux-optimistic-ui'
import type { RootState } from 'store/store'
import type { QueueItem } from 'shared/types'

const getActiveQueue = createSelector(
  [
    (state: RootState) => ensureState(state.queue).result,
    (state: RootState) => ensureState(state.queue).entities,
    (state: RootState) => state.status.historyJSON,
  ],
  (result, entities, historyJSON) => {
    let history: number[] = []
    try {
      const parsed = JSON.parse(historyJSON)
      if (Array.isArray(parsed)) history = parsed
    } catch {
      // Persisted database state remains authoritative.
    }

    return {
      result: result.filter(id => !entities[id].isPlayed && !history.includes(id)) as number[],
      entities: entities as Record<number, QueueItem>,
    }
  },
)

export default getActiveQueue
