import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../lib/HttpApi', () => ({
  default: class MockHttpApi {
    get = mocks.get
  },
}))

import { syncLibrary } from './librarySync'

describe('library synchronization', () => {
  it('fetches again when a newer invalidation arrives during an active request', async () => {
    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    mocks.get
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve }))
    const store = { dispatch: vi.fn() }

    const request = syncLibrary(store, 2)
    expect(syncLibrary(store, 3)).toBe(request)
    resolveFirst({ version: 2, artists: {}, songs: {} })
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
    resolveSecond({ version: 3, artists: {}, songs: {} })
    await request

    expect(store.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'library/PUSH',
      payload: expect.objectContaining({ version: 3 }),
    }))

    mocks.get.mockResolvedValueOnce({ version: 1, artists: {}, songs: {} })
    await syncLibrary(store, 1)
    expect(mocks.get).toHaveBeenCalledTimes(3)
  })
})
