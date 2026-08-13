import { describe, expect, it } from 'vitest'
import type { QueueItem } from 'shared/types'
import type { PlayerState } from '../modules/player'
import type { ActiveQueue } from './playbackQueue'
import {
  advanceStatus,
  findNextUserId,
  getPrecacheMediaIds,
  replayStatus,
  selectPlaybackItems,
  shouldAdvancePlayback,
} from './playbackQueue'

const item = (queueId: number, userId = queueId): QueueItem => ({
  queueId,
  userId,
  mediaId: queueId * 10,
  songId: queueId,
  prevQueueId: queueId - 1,
  rgTrackGain: 0,
  rgTrackPeak: 1,
  userDateUpdated: 0,
  userDisplayName: `User ${userId}`,
  isPlayed: false,
  isVideoKeyingEnabled: false,
})

const queue = {
  result: [1, 2, 3],
  entities: { 1: item(1, 10), 2: item(2, 10), 3: item(3, 20) },
}

const player = (overrides: Partial<PlayerState> = {}) => ({
  queueId: 1,
  history: [],
  _priorityQueueId: null,
  ...overrides,
} as PlayerState)

describe('playback queue transitions', () => {
  it('selects priority before regular next', () => {
    expect(selectPlaybackItems(queue, player({ _priorityQueueId: 3 })).next?.queueId).toBe(3)
  })

  it('advances and records the current item once', () => {
    const status = advanceStatus(player(), queue.entities[1], queue.entities[2])
    expect(status).toMatchObject({ queueId: 2, history: [1], isAtQueueEnd: false })
  })

  it('truncates replay history from the requested item', () => {
    const status = replayStatus(player({ queueId: 3, history: [1, 2, 3] }), queue.entities[2])
    expect(status.history).toEqual([1])
  })

  it('finds the next singer and preserves precache order', () => {
    expect(findNextUserId(queue, queue.entities[1])).toBe(20)
    expect(getPrecacheMediaIds(queue, queue.entities[1], queue.entities[3])).toEqual([30, 20])
  })

  it('settles an old playing session when the reconnected queue is empty', () => {
    const emptyQueue: ActiveQueue = { result: [], entities: {} }
    const stalePlayer = player({ isPlaying: true, isAtQueueEnd: false })
    expect(shouldAdvancePlayback(stalePlayer, emptyQueue)).toBe(true)

    const settledPlayer = player({ isPlaying: true, isAtQueueEnd: true })
    expect(shouldAdvancePlayback(settledPlayer, emptyQueue)).toBe(false)
  })

  it('honors an explicit play-next request even after reaching the queue end', () => {
    expect(shouldAdvancePlayback(player({
      isPlaying: true,
      isAtQueueEnd: true,
      _isPlayingNext: true,
    }), { result: [], entities: {} } as ActiveQueue)).toBe(true)
  })
})
