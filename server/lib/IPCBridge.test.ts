import type { ChildProcess } from 'child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPCChild, IPCParent } from './IPCBridge.js'

afterEach(() => {
  IPCChild.handlers = {}
  for (const request of IPCChild.requests.values()) clearTimeout(request.timeout)
  IPCChild.requests.clear()
  IPCChild.reqId = 0
  IPCParent.children.clear()
  IPCParent.handlers = {}
})

describe('IPCChild responses', () => {
  it('settles and removes the matching request', () => {
    const resolve = vi.fn()
    const reject = vi.fn()
    const timeout = setTimeout(() => {}, 10_000)
    IPCChild.requests.set(7, { resolve, reject, timeout })

    IPCChild.handle({
      type: 'example_SUCCESS',
      payload: { ok: true },
      meta: { pid: process.pid, reqId: 7 },
    })

    expect(resolve).toHaveBeenCalledWith({ ok: true })
    expect(reject).not.toHaveBeenCalled()
    expect(IPCChild.requests.has(7)).toBe(false)
  })

  it('reconstructs serialized errors and removes the request', () => {
    const resolve = vi.fn()
    const reject = vi.fn()
    const timeout = setTimeout(() => {}, 10_000)
    IPCChild.requests.set(8, { resolve, reject, timeout })

    IPCChild.handle({
      type: 'example_ERROR',
      error: { name: 'ExampleError', message: 'failed' },
      meta: { pid: process.pid, reqId: 8 },
    })

    expect(resolve).not.toHaveBeenCalled()
    expect(reject).toHaveBeenCalledWith(expect.objectContaining({ name: 'ExampleError', message: 'failed' }))
    expect(IPCChild.requests.has(8)).toBe(false)
  })
})

describe('IPCParent transport', () => {
  it('returns false instead of throwing when no child is available', () => {
    expect(IPCParent.send({ type: 'example' })).toBe(false)
  })

  it('serializes synchronous handler failures in request responses', async () => {
    const send = vi.fn((_action, callback) => {
      callback?.(null)
      return true
    })
    const child = {
      connected: true,
      on: vi.fn(),
      pid: 123,
      send,
    } as unknown as ChildProcess
    IPCParent.addChild(child)
    IPCParent.use({
      example: () => {
        throw new TypeError('failed')
      },
    })

    IPCParent.handle({ type: 'example', meta: { pid: 123, reqId: 9 } })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send.mock.calls[0][0]).toEqual(expect.objectContaining({
      type: 'example_ERROR',
      error: expect.objectContaining({ name: 'TypeError', message: 'failed' }),
    }))
  })
})
