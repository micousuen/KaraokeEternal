import { describe, expect, it } from 'vitest'
import { withoutUndefinedStatus } from './playerStatus'

describe('player status boundary', () => {
  it('does not let undefined partial values replace required status fields', () => {
    expect(withoutUndefinedStatus({
      isVideoKeyingEnabled: undefined,
      isPlaying: false,
      position: 0,
    })).toEqual({ isPlaying: false, position: 0 })
  })
})
