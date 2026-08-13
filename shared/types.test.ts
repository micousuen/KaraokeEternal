import { describe, expect, it } from 'vitest'
import { createInitialPlaybackStatus } from './types.js'

describe('createInitialPlaybackStatus', () => {
  it('returns the same public defaults with independent history arrays', () => {
    const first = createInitialPlaybackStatus()
    const second = createInitialPlaybackStatus()
    first.history.push(1)

    expect(second.history).toEqual([])
    expect(first).toEqual(expect.objectContaining({
      audioTrack: 0,
      mediaType: null,
      queueId: -1,
      volume: 1,
    }))
  })
})
