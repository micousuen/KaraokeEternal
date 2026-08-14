import Queue from './Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { PLAYER_CMD_PRIORITY, QUEUE_ADD, QUEUE_MOVE, QUEUE_PLAY_NEXT, QUEUE_REMOVE, QUEUE_SHUFFLE, QUEUE_SYNC } from '../../shared/actionTypes.js'
import { emitToRoom } from '../lib/socketActions.js'
import { getQueueSnapshot, publishQueue, sendQueueSnapshot } from './QueuePublisher.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'
import { runQueueOperation } from './QueueOperationLane.js'

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [QUEUE_ADD]: (sock, { payload }, acknowledge) => runQueueOperation(sock.user.roomId, async () => {
    const { songId } = payload

    try {
      await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: err.message,
      })
    }

    try {
      Queue.add({
        roomId: sock.user.roomId,
        songId,
        userId: sock.user.userId,
      })
    } catch (err) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // success
    acknowledge({ type: QUEUE_ADD + '_SUCCESS' })

    // to all in room
    publishQueue(sock.server, sock.user.roomId)
  }),
  [QUEUE_MOVE]: (sock, action, acknowledge) => runQueueOperation(sock.user.roomId, async () => {
    const { payload } = action
    const { queueId, prevQueueId } = payload

    try {
      await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_MOVE + '_ERROR',
        error: err.message,
      })
    }
    if (rejectConflict(sock, action, acknowledge, QUEUE_MOVE)) return

    Queue.move({
      prevQueueId,
      queueId,
      roomId: sock.user.roomId,
    })

    // success
    acknowledge({ type: QUEUE_MOVE + '_SUCCESS' })

    // tell room
    publishQueue(sock.server, sock.user.roomId)
  }),
  [QUEUE_PLAY_NEXT]: (sock, action, acknowledge) => runQueueOperation(sock.user.roomId, async () => {
    const { queueId, prevQueueId } = action.payload
    await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    if (rejectConflict(sock, action, acknowledge, QUEUE_PLAY_NEXT)) return
    if (!Queue.isInRoom(queueId, sock.user.roomId)) throw new Error('Queue item is not in this room')

    Queue.move({ queueId, prevQueueId, roomId: sock.user.roomId })
    emitToRoom(sock, PLAYER_CMD_PRIORITY, { queueId })
    acknowledge({ type: QUEUE_PLAY_NEXT + '_SUCCESS' })
    publishQueue(sock.server, sock.user.roomId)
  }),
  [QUEUE_SHUFFLE]: (sock, action, acknowledge) => runQueueOperation(sock.user.roomId, async () => {
    const { payload } = action
    await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    if (rejectConflict(sock, action, acknowledge, QUEUE_SHUFFLE)) return
    Queue.setOrder(sock.user.roomId, payload.queueIds)

    acknowledge({ type: QUEUE_SHUFFLE + '_SUCCESS' })

    emitToRoom(sock, PLAYER_CMD_PRIORITY, { queueId: null })
    publishQueue(sock.server, sock.user.roomId)
  }),
  [QUEUE_REMOVE]: (sock, action, acknowledge) => runQueueOperation(sock.user.roomId, () => {
    if (rejectConflict(sock, action, acknowledge, QUEUE_REMOVE)) return
    const { payload } = action
    const { queueId } = payload
    const ids = Array.isArray(queueId) ? queueId : [queueId]

    if (ids.some(id => !Queue.isInRoom(id, sock.user.roomId))) {
      return acknowledge({
        type: QUEUE_REMOVE + '_ERROR',
        error: 'Queue item is not in this room',
      })
    }

    for (const id of ids) {
      Queue.remove(id)
    }

    // success
    acknowledge({ type: QUEUE_REMOVE + '_SUCCESS' })

    // tell room
    publishQueue(sock.server, sock.user.roomId)
  }),
  [QUEUE_SYNC]: sock => runQueueOperation(sock.user.roomId, () => sendQueueSnapshot(sock, sock.user.roomId)),
} satisfies SocketHandlerMap

function rejectConflict (sock, action, acknowledge, actionType: string): boolean {
  const queue = getQueueSnapshot(sock.user.roomId)
  if (action.meta?.baseRevision === queue.revision) return false

  acknowledge({
    type: actionType + '_ERROR',
    error: 'Someone else changed the queue first. Your change was not applied; the queue has been refreshed.',
    payload: { code: 'QUEUE_CONFLICT', queue },
  })
  return true
}

export default ACTION_HANDLERS
