import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from 'store/store'
import type { QueueItem } from 'shared/types'

// The server's linked-list order is canonical. Queue drag/move operations
// persist that order in SQLite, so display, playback, and pre-cache must all
// consume it directly rather than applying a second client-side reordering.
const getRoundRobinQueue = createSelector(
  [
    (state: RootState) => state.queue.result,
    (state: RootState) => state.queue.entities,
  ],
  (result, entities) => ({
    result: result as number[],
    entities: entities as Record<number, QueueItem>,
  }),
)

export default getRoundRobinQueue
