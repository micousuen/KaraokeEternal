import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYER_EMIT_CLAIM, PLAYER_EMIT_POSITION, PLAYER_POSITION, PLAYER_STATUS } from '../../shared/actionTypes.js'
import { createInitialPlaybackStatus } from '../../shared/types.js'

const mocks = vi.hoisted(() => ({
  markPlayed: vi.fn(),
  publishQueue: vi.fn(),
}))

vi.mock('../Queue/Queue.js', () => ({
  default: {
    isInRoom: vi.fn(),
    markPlayed: mocks.markPlayed,
  },
}))
vi.mock('../Queue/QueuePublisher.js', () => ({ publishQueue: mocks.publishQueue }))

import handlers from './socket.js'

beforeEach(() => vi.clearAllMocks())

describe('player socket status', () => {
  it('atomically claims with status and echoes status and progress to the player socket', () => {
    const emit = vi.fn()
    const volatileEmit = vi.fn()
    const room = { emit, volatile: { emit: volatileEmit } }
    const server = {
      sockets: { sockets: new Map() },
      to: vi.fn(() => room),
    }
    const socket = {
      id: 'player-socket',
      user: { isAdmin: true, roomId: 810 },
      server,
    }
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

    handlers[PLAYER_EMIT_CLAIM](socket, { payload: status })
    handlers[PLAYER_EMIT_POSITION](socket, { payload: { position: 42 } })

    expect(server.to).toHaveBeenCalledWith('ROOM_ID_810')
    expect(emit).toHaveBeenCalledWith('action', { type: PLAYER_STATUS, payload: status })
    expect(volatileEmit).toHaveBeenCalledWith('action', {
      type: PLAYER_POSITION,
      payload: { position: 42 },
    })
  })
})
