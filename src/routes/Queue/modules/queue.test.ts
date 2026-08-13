import { describe, expect, it } from 'vitest'
import { QUEUE_ADD, QUEUE_MOVE, QUEUE_PATCH } from 'shared/actionTypes'
import reducer, { queuePush, queueSong } from './queue'
import type { QueueItem, QueueSnapshot } from 'shared/types'

describe('queue optimistic updates', () => {
  it('removes only the failed optimistic item', () => {
    const first = {
      ...queueSong(10),
      meta: { isOptimistic: true, optimisticId: 1 },
    }
    const second = {
      ...queueSong(20),
      meta: { isOptimistic: true, optimisticId: 2 },
    }
    let state = reducer(undefined, first)
    state = reducer(state, second)

    state = reducer(state, {
      type: `${QUEUE_ADD}_ERROR`,
      error: true,
      meta: { optimisticId: 1 },
    })

    expect(state.result).toHaveLength(1)
    expect(state.entities[state.result[0]]).toEqual(expect.objectContaining({
      songId: 20,
      optimisticId: 2,
    }))
  })

  it('replaces stale local state with the server snapshot after a conflict', () => {
    const original = snapshot(4, [1, 2, 3])
    const authoritative = snapshot(5, [1, 3, 2])
    let state = reducer(undefined, queuePush(original))

    state = reducer(state, {
      type: `${QUEUE_MOVE}_ERROR`,
      error: 'Someone else changed the queue first.',
      payload: { code: 'QUEUE_CONFLICT', queue: authoritative },
    })
    expect(state).toEqual(expect.objectContaining(authoritative))

    state = reducer(state, {
      type: QUEUE_PATCH,
      payload: { baseRevision: 4, revision: 5, result: [1, 3, 2], changed: {}, removed: [] },
    })
    expect(state).toEqual(expect.objectContaining(authoritative))
  })
})

function snapshot (revision: number, result: number[]): QueueSnapshot {
  return {
    revision,
    result,
    entities: Object.fromEntries(result.map(queueId => [queueId, queueItem(queueId)])),
  }
}

function queueItem (queueId: number): QueueItem {
  return {
    queueId,
    songId: queueId,
    userId: 1,
    prevQueueId: null,
    mediaId: queueId,
    rgTrackGain: 0,
    rgTrackPeak: 1,
    userDateUpdated: 1,
    userDisplayName: 'User',
    isPlayed: false,
    isVideoKeyingEnabled: false,
  }
}
