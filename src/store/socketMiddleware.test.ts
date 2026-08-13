import type { UnknownAction } from '@reduxjs/toolkit'
import type { Socket } from 'socket.io-client'
import { describe, expect, it, vi } from 'vitest'
import createSocketMiddleware from './socketMiddleware'
import { PLAYER_REQ_SEEK, QUEUE_MOVE, QUEUE_PATCH, QUEUE_SYNC } from 'shared/actionTypes'

describe('socketMiddleware optimistic transactions', () => {
  it('matches out-of-order callbacks to their original transactions', () => {
    const callbacks: Array<(error: Error | null, action: UnknownAction) => void> = []
    const emit = vi.fn((_event, _action, callback) => callbacks.push(callback))
    const socket = {
      connected: true,
      io: { opts: {}, on: vi.fn() },
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      volatile: { emit: vi.fn() },
      timeout: vi.fn(() => ({ emit })),
    } as unknown as Socket
    const next = vi.fn()
    const middleware = createSocketMiddleware(socket, 'server/')
    const invoke = middleware({ dispatch: vi.fn(), getState: vi.fn() })(next)

    invoke({ type: 'server/first', meta: { isOptimistic: true } })
    invoke({ type: 'server/second', meta: { isOptimistic: true } })

    const firstTransaction = next.mock.calls[0][0].meta.optimisticId
    const secondTransaction = next.mock.calls[1][0].meta.optimisticId
    expect(firstTransaction).toEqual(expect.any(Number))
    expect(secondTransaction).toEqual(expect.any(Number))
    expect(firstTransaction).not.toBe(secondTransaction)

    callbacks[1](null, { type: 'server/second_SUCCESS' })
    callbacks[0](null, { type: 'server/first_ERROR', error: true })

    expect(next.mock.calls[2][0].meta).toEqual(expect.objectContaining({
      optimisticId: secondTransaction,
      optimisticAction: { type: 'server/second' },
    }))
    expect(next.mock.calls[3][0].meta).toEqual(expect.objectContaining({
      optimisticId: firstTransaction,
      optimisticAction: { type: 'server/first' },
    }))
  })

  it('uses volatile delivery for playback traffic', () => {
    const socket = createSocketMock()
    const next = vi.fn()
    const invoke = createSocketMiddleware(socket as unknown as Socket, 'server/')({
      dispatch: vi.fn(),
      getState: vi.fn(() => ({})),
    })(next)

    invoke({ type: PLAYER_REQ_SEEK, payload: 12 })

    expect(socket.volatile.emit).toHaveBeenCalledWith('action', {
      type: PLAYER_REQ_SEEK,
      payload: 12,
    })
    expect(socket.timeout).not.toHaveBeenCalled()
  })

  it('refreshes handshake versions and requests a queue snapshot after a revision gap', () => {
    const socket = createSocketMock()
    const store = {
      dispatch: vi.fn(),
      getState: vi.fn(() => ({ library: { version: 7 }, starCounts: { version: 9 }, queue: { revision: 2 } })),
    }
    createSocketMiddleware(socket as unknown as Socket, 'server/')(store)

    const reconnect = socket.io.on.mock.calls.find(call => call[0] === 'reconnect_attempt')?.[1]
    reconnect()
    expect(socket.io.opts.query).toEqual({ library: 7, stars: 9 })

    const receive = socket.on.mock.calls.find(call => call[0] === 'action')?.[1]
    receive({ type: QUEUE_PATCH, payload: { baseRevision: 1, revision: 3 } })
    expect(socket.emit).toHaveBeenCalledWith('action', { type: QUEUE_SYNC })
  })

  it('sends the observed queue revision with conflict-sensitive mutations', () => {
    const requests: unknown[] = []
    const socket = createSocketMock()
    socket.timeout.mockReturnValue({
      emit: vi.fn((_event, request) => requests.push(request)),
    })
    const invoke = createSocketMiddleware(socket as unknown as Socket, 'server/')({
      dispatch: vi.fn(),
      getState: vi.fn(() => ({ queue: { revision: 12 } })),
    })(vi.fn())

    invoke({ type: QUEUE_MOVE, payload: { queueId: 8, prevQueueId: 3 } })

    expect(requests[0]).toEqual({
      type: QUEUE_MOVE,
      payload: { queueId: 8, prevQueueId: 3 },
      meta: expect.objectContaining({ baseRevision: 12 }),
    })
  })
})

function createSocketMock () {
  return {
    connected: true,
    io: { opts: {} as { query?: unknown }, on: vi.fn() },
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    volatile: { emit: vi.fn() },
    timeout: vi.fn(),
  }
}
