import { describe, expect, it } from 'vitest'
import type { QueueItem, QueueSnapshot } from '../../shared/types.js'
import { createQueuePatch } from './QueuePublisher.js'

const item = (queueId: number, isPlayed = false): QueueItem => ({
  queueId,
  songId: queueId + 10,
  userId: 1,
  prevQueueId: queueId === 1 ? null : queueId - 1,
  mediaId: queueId + 20,
  rgTrackGain: 0,
  rgTrackPeak: 1,
  userDateUpdated: 1,
  userDisplayName: 'User',
  isPlayed,
  isVideoKeyingEnabled: false,
})

describe('queue publisher patches', () => {
  it('sends only changed entities with authoritative order and revisions', () => {
    const previous: QueueSnapshot = {
      revision: 4,
      result: [1, 2],
      entities: { 1: item(1), 2: item(2) },
    }
    const patch = createQueuePatch(previous, {
      result: [2, 1],
      entities: { 1: item(1), 2: item(2, true) },
    })

    expect(patch).toEqual({
      baseRevision: 4,
      revision: 5,
      result: [2, 1],
      changed: { 2: item(2, true) },
      removed: [],
    })
  })

  it('does not publish an unchanged queue', () => {
    const previous: QueueSnapshot = { revision: 1, result: [1], entities: { 1: item(1) } }
    expect(createQueuePatch(previous, { result: [1], entities: { 1: item(1) } })).toBeNull()
  })
})
