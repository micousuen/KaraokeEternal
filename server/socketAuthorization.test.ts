import { afterEach, describe, expect, it, vi } from 'vitest'
import Prefs from './Prefs/Prefs.js'
import prefsHandlers from './Prefs/socket.js'
import roomsHandlers from './Rooms/socket.js'
import {
  PREFS_PUSH,
  PREFS_SET,
  ROOM_PREFS_PUSH_REQUEST,
  _ERROR,
} from '../shared/actionTypes.js'

afterEach(() => vi.restoreAllMocks())

describe('socket authorization', () => {
  it('stops an unauthorized preference write', () => {
    const acknowledge = vi.fn()
    const set = vi.spyOn(Prefs, 'set')
    const socket = { user: { isAdmin: false } }

    prefsHandlers[PREFS_SET](socket, { payload: { key: 'example', data: true } }, acknowledge)

    expect(acknowledge).toHaveBeenCalledWith({
      type: PREFS_SET + _ERROR,
      error: 'Unauthorized',
    })
    expect(set).not.toHaveBeenCalled()
  })

  it('pushes private preferences only to connected admins', () => {
    vi.spyOn(Prefs, 'set').mockReturnValue(true)
    vi.spyOn(Prefs, 'get').mockReturnValue({ private: 'settings' } as never)
    const targetedEmit = vi.fn()
    const server = {
      sockets: {
        sockets: new Map([
          ['admin', { id: 'admin', user: { isAdmin: true } }],
          ['user', { id: 'user', user: { isAdmin: false } }],
        ]),
      },
      to: vi.fn(() => ({ emit: targetedEmit })),
      emit: vi.fn(),
    }
    const socket = { id: 'admin', user: { isAdmin: true, name: 'Admin' }, server }

    prefsHandlers[PREFS_SET](socket, { payload: { key: 'example', data: true } }, vi.fn())

    expect(server.to).toHaveBeenCalledWith(['admin'])
    expect(targetedEmit).toHaveBeenCalledWith('action', {
      type: PREFS_PUSH,
      payload: { private: 'settings' },
    })
    expect(server.emit).not.toHaveBeenCalled()
  })

  it('stops an unauthorized room preference push before reading the room', async () => {
    const acknowledge = vi.fn()
    const server = { in: vi.fn() }
    const socket = { user: { isAdmin: false }, server }

    await roomsHandlers[ROOM_PREFS_PUSH_REQUEST](socket, { payload: { roomId: 1, prefs: {} as never } }, acknowledge)

    expect(acknowledge).toHaveBeenCalledWith({
      type: ROOM_PREFS_PUSH_REQUEST + _ERROR,
      error: 'Unauthorized',
    })
    expect(server.in).not.toHaveBeenCalled()
  })
})
