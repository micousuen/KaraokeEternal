import { describe, expect, it } from 'vitest'
import { PLAYER_EMIT_STATUS, QUEUE_REMOVE, QUEUE_SHUFFLE } from '../../shared/actionTypes.js'
import { createInitialPlaybackStatus } from '../../shared/types.js'
import { consumeSocketRateLimit, validateSocketAction } from './socketValidation.js'

describe('socket action validation', () => {
  it('accepts a complete player status and rejects malformed status data', () => {
    const status = {
      ...createInitialPlaybackStatus(),
      visualizer: {
        isEnabled: true,
        isSupported: true,
        presetKey: 'preset',
        presetName: 'Preset',
        sensitivity: 1,
      },
    }
    expect(validateSocketAction({ type: PLAYER_EMIT_STATUS, payload: status })).toBeNull()
    expect(validateSocketAction({ type: PLAYER_EMIT_STATUS, payload: { ...status, position: Infinity } }))
      .toBe('Player position is invalid')
  })

  it('bounds queue mutation payloads', () => {
    expect(validateSocketAction({
      type: QUEUE_REMOVE,
      payload: { queueId: [1, 2] },
      meta: { baseRevision: 3 },
    })).toBeNull()
    expect(validateSocketAction({
      type: QUEUE_SHUFFLE,
      payload: { queueIds: Array(10_001).fill(1) },
      meta: { baseRevision: 3 },
    })).toBe('queueIds must be a bounded integer array, with a valid baseRevision')
    expect(validateSocketAction({
      type: QUEUE_REMOVE,
      payload: { queueId: 1 },
    })).toBe('queueId must be an integer or a bounded integer array, with a valid baseRevision')
  })

  it('rate limits durable and ephemeral traffic independently', () => {
    const socket = { data: {} }
    for (let i = 0; i < 50; i++) expect(consumeSocketRateLimit(socket, false)).toBe(true)
    expect(consumeSocketRateLimit(socket, false)).toBe(false)
    expect(consumeSocketRateLimit(socket, true)).toBe(true)
  })
})
