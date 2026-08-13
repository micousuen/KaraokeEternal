import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAYER_CMD_PRIORITY, QUEUE_MOVE, QUEUE_PLAY_NEXT } from '../../shared/actionTypes.js'

const mocks = vi.hoisted(() => ({
  getQueueSnapshot: vi.fn(),
  move: vi.fn(),
  publishQueue: vi.fn(),
  validate: vi.fn(),
  emitToRoom: vi.fn(),
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
vi.mock('../lib/socketActions.js', () => ({ emitToRoom: mocks.emitToRoom }))

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

  it('moves and prioritizes Play Next inside the same revision-guarded lane', async () => {
    mocks.validate.mockResolvedValue(true)
    mocks.getQueueSnapshot.mockReturnValue({ revision: 4, result: [], entities: {} })
    const Queue = (await import('./Queue.js')).default
    vi.mocked(Queue.isInRoom).mockReturnValue(true)
    const socket = { user: { roomId: 12 }, server: {} }
    const acknowledge = vi.fn()

    await handlers[QUEUE_PLAY_NEXT](socket, {
      payload: { queueId: 8, prevQueueId: 3 },
      meta: { baseRevision: 4 },
    }, acknowledge)

    expect(mocks.move).toHaveBeenCalledWith({ roomId: 12, queueId: 8, prevQueueId: 3 })
    expect(mocks.emitToRoom).toHaveBeenCalledWith(socket, PLAYER_CMD_PRIORITY, { queueId: 8 })
    expect(acknowledge).toHaveBeenCalledWith({ type: `${QUEUE_PLAY_NEXT}_SUCCESS` })
  })

  it('does not prioritize Play Next when its queue revision lost a conflict', async () => {
    mocks.validate.mockResolvedValue(true)
    mocks.getQueueSnapshot.mockReturnValue({ revision: 5, result: [], entities: {} })

    await handlers[QUEUE_PLAY_NEXT]({ user: { roomId: 12 }, server: {} }, {
      payload: { queueId: 8, prevQueueId: 3 },
      meta: { baseRevision: 4 },
    }, vi.fn())

    expect(mocks.move).not.toHaveBeenCalled()
    expect(mocks.emitToRoom).not.toHaveBeenCalled()
  })
})
