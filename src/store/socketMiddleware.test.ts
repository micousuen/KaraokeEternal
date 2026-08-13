import type { UnknownAction } from '@reduxjs/toolkit'
import type { Socket } from 'socket.io-client'
import { describe, expect, it, vi } from 'vitest'
import { BEGIN, COMMIT, REVERT } from 'redux-optimistic-ui'
import createSocketMiddleware from './socketMiddleware'

describe('socketMiddleware optimistic transactions', () => {
  it('matches out-of-order callbacks to their original transactions', () => {
    const callbacks: Array<(action: UnknownAction) => void> = []
    const socket = {
      on: vi.fn(),
      emit: vi.fn((_event, _action, callback) => callbacks.push(callback)),
    } as unknown as Socket
    const next = vi.fn()
    const middleware = createSocketMiddleware(socket, 'server/')
    const invoke = middleware({ dispatch: vi.fn(), getState: vi.fn() })(next)

    invoke({ type: 'server/first', meta: { isOptimistic: true } })
    invoke({ type: 'server/second', meta: { isOptimistic: true } })

    const firstTransaction = next.mock.calls[0][0].meta.optimistic
    const secondTransaction = next.mock.calls[1][0].meta.optimistic
    expect(firstTransaction).toEqual(expect.objectContaining({ type: BEGIN }))
    expect(secondTransaction).toEqual(expect.objectContaining({ type: BEGIN }))
    expect(firstTransaction.id).not.toBe(secondTransaction.id)

    callbacks[1]({ type: 'server/second_SUCCESS' })
    callbacks[0]({ type: 'server/first_ERROR', error: true })

    expect(next.mock.calls[2][0].meta.optimistic).toEqual({ type: COMMIT, id: secondTransaction.id })
    expect(next.mock.calls[3][0].meta.optimistic).toEqual({ type: REVERT, id: firstTransaction.id })
  })
})
