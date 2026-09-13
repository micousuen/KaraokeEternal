import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PLAYER_CMD_NEXT,
  PLAYER_CMD_OPTIONS,
  PLAYER_CMD_PAUSE,
  PLAYER_CMD_PLAY,
  PLAYER_CMD_SEEK,
  PLAYER_CMD_VOLUME,
  PLAYER_EMIT_CLAIM,
  PLAYER_EMIT_POSITION,
  PLAYER_POSITION,
  PLAYER_REQ_NEXT,
  PLAYER_REQ_OPTIONS,
  PLAYER_REQ_PAUSE,
  PLAYER_REQ_PLAY,
  PLAYER_REQ_SEEK,
  PLAYER_REQ_VOLUME,
  PLAYER_STATUS,
} from '../../shared/actionTypes.js'
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

  it.each([
    [PLAYER_REQ_PLAY, PLAYER_CMD_PLAY, undefined],
    [PLAYER_REQ_PAUSE, PLAYER_CMD_PAUSE, undefined],
    [PLAYER_REQ_NEXT, PLAYER_CMD_NEXT, undefined],
    [PLAYER_REQ_SEEK, PLAYER_CMD_SEEK, 42],
    [PLAYER_REQ_VOLUME, PLAYER_CMD_VOLUME, 0.5],
    [PLAYER_REQ_OPTIONS, PLAYER_CMD_OPTIONS, { audioTrack: 1, showScript: true }],
  ])('allows a non-admin room member to send %s', (request, command, payload) => {
    const emit = vi.fn()
    const socket = {
      id: 'member-socket',
      user: { isAdmin: false, isGuest: true, roomId: 810 },
      server: { to: vi.fn(() => ({ emit })) },
    }

    handlers[request](socket, { payload })

    expect(socket.server.to).toHaveBeenCalledWith('ROOM_ID_810')
    expect(emit).toHaveBeenCalledWith('action', payload === undefined
      ? { type: command }
      : { type: command, payload })
  })
})
