import type { MiddlewareAPI } from '@reduxjs/toolkit'
import { describe, expect, it, vi } from 'vitest'
import createThrottleMiddleware, { THROTTLE_CANCEL } from './throttleMiddleware'

describe('throttleMiddleware', () => {
  it('emits the leading action and latest trailing action', () => {
    vi.useFakeTimers()
    const next = vi.fn()
    const invoke = createThrottleMiddleware(1000)({} as MiddlewareAPI)(next)

    invoke({ type: 'update', payload: 1, meta: { throttle: { wait: 100, leading: true } } })
    invoke({ type: 'update', payload: 2, meta: { throttle: { wait: 100, leading: true } } })
    invoke({ type: 'update', payload: 3, meta: { throttle: { wait: 100, leading: true } } })
    expect(next).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    expect(next).toHaveBeenCalledTimes(2)
    expect(next.mock.calls[1][0].payload).toBe(3)
    vi.useRealTimers()
  })

  it('cancels a pending trailing action', () => {
    vi.useFakeTimers()
    const next = vi.fn()
    const invoke = createThrottleMiddleware(1000)({} as MiddlewareAPI)(next)

    invoke({ type: 'update', meta: { throttle: { wait: 100, leading: false } } })
    invoke({ type: THROTTLE_CANCEL, payload: { type: 'update' } })
    vi.advanceTimersByTime(100)
    expect(next).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
