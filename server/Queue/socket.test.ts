import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QUEUE_MOVE } from '../../shared/actionTypes.js'

const mocks = vi.hoisted(() => ({
  getQueueSnapshot: vi.fn(),
  move: vi.fn(),
  publishQueue: vi.fn(),
  validate: vi.fn(),
}))

vi.mock('./Queue.js', () => ({
  default: {
    add: vi.fn(),
    isInRoom: vi.fn(),
    move: mocks.move,
    remove: vi.fn(),
    setOrder: vi.fn(),
  },
}))
vi.mock('../Rooms/Rooms.js', () => ({ default: { validate: mocks.validate } }))
vi.mock('./QueuePublisher.js', () => ({
  getQueueSnapshot: mocks.getQueueSnapshot,
  publishQueue: mocks.publishQueue,
  sendQueueSnapshot: vi.fn(),
}))
vi.mock('../lib/socketActions.js', () => ({ emitToRoom: vi.fn() }))

import handlers from './socket.js'

beforeEach(() => vi.clearAllMocks())

describe('queue conflict handling', () => {
  it('accepts the first move and rejects a concurrent move based on the same revision', async () => {
    let revision = 10
    let releaseValidation: () => void = () => undefined
    const firstValidation = new Promise<void>((resolve) => {
      releaseValidation = resolve
    })
    mocks.validate.mockReturnValueOnce(firstValidation).mockResolvedValue(true)
    mocks.getQueueSnapshot.mockImplementation(() => ({ revision, result: [], entities: {} }))
    mocks.publishQueue.mockImplementation(() => {
      revision++
    })
    const socket = { user: { roomId: 991 }, server: {} }
    const firstAck = vi.fn()
    const secondAck = vi.fn()

    const first = handlers[QUEUE_MOVE](socket, {
      payload: { queueId: 8, prevQueueId: 3 },
      meta: { baseRevision: 10 },
    }, firstAck)
    const second = handlers[QUEUE_MOVE](socket, {
      payload: { queueId: 8, prevQueueId: 5 },
      meta: { baseRevision: 10 },
    }, secondAck)

    await Promise.resolve()
    expect(mocks.move).not.toHaveBeenCalled()
    releaseValidation()
    await Promise.all([first, second])

    expect(mocks.move).toHaveBeenCalledOnce()
    expect(mocks.move).toHaveBeenCalledWith({ roomId: 991, queueId: 8, prevQueueId: 3 })
    expect(firstAck).toHaveBeenCalledWith({ type: `${QUEUE_MOVE}_SUCCESS` })
    expect(secondAck).toHaveBeenCalledWith(expect.objectContaining({
      type: `${QUEUE_MOVE}_ERROR`,
      payload: expect.objectContaining({
        code: 'QUEUE_CONFLICT',
        queue: expect.objectContaining({ revision: 11 }),
      }),
    }))
  })
})
