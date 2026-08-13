import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ publishAllQueues: vi.fn() }))
vi.mock('../Queue/QueuePublisher.js', () => ({ publishAllQueues: mocks.publishAllQueues }))

import User from './User.js'
import { removeExpiredGuests } from './GuestCleanup.js'

beforeEach(() => vi.restoreAllMocks())

describe('guest cleanup', () => {
  it('removes expired guests, disconnects their sessions, and refreshes queues once', () => {
    vi.spyOn(User, 'getExpiredGuestIds').mockReturnValue([2, 3])
    const remove = vi.spyOn(User, 'remove').mockImplementation(() => undefined)
    const disconnectSockets = vi.fn()
    const io = { in: vi.fn(() => ({ disconnectSockets })) }

    expect(removeExpiredGuests(io, Date.UTC(2026, 0, 8))).toEqual([2, 3])
    expect(remove).toHaveBeenCalledTimes(2)
    expect(io.in).toHaveBeenCalledWith('USER_ID_2')
    expect(io.in).toHaveBeenCalledWith('USER_ID_3')
    expect(disconnectSockets).toHaveBeenCalledTimes(2)
    expect(mocks.publishAllQueues).toHaveBeenCalledOnce()
  })
})
