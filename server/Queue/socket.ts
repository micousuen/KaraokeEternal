import Queue from './Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { PLAYER_CMD_PRIORITY, QUEUE_ADD, QUEUE_MOVE, QUEUE_REMOVE, QUEUE_SHUFFLE, QUEUE_PUSH } from '../../shared/actionTypes.js'
import { emitToRoom } from '../lib/socketActions.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [QUEUE_ADD]: async (sock, { payload }, acknowledge) => {
    const { songId } = payload

    try {
      await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: err.message,
      })
    }

    Queue.add({
      roomId: sock.user.roomId,
      songId,
      userId: sock.user.userId,
    })

    // success
    acknowledge({ type: QUEUE_ADD + '_SUCCESS' })

    // to all in room
    emitToRoom(sock, QUEUE_PUSH, Queue.get(sock.user.roomId))
  },
  [QUEUE_MOVE]: async (sock, { payload }, acknowledge) => {
    const { queueId, prevQueueId } = payload

    try {
      await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_MOVE + '_ERROR',
        error: err.message,
      })
    }

    Queue.move({
      prevQueueId,
      queueId,
      roomId: sock.user.roomId,
    })

    // success
    acknowledge({ type: QUEUE_MOVE + '_SUCCESS' })

    // tell room
    emitToRoom(sock, QUEUE_PUSH, Queue.get(sock.user.roomId))
  },
  [QUEUE_SHUFFLE]: async (sock, { payload }, acknowledge) => {
    await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    Queue.setOrder(sock.user.roomId, payload.queueIds)

    acknowledge({ type: QUEUE_SHUFFLE + '_SUCCESS' })

    emitToRoom(sock, PLAYER_CMD_PRIORITY, { queueId: null })
    emitToRoom(sock, QUEUE_PUSH, Queue.get(sock.user.roomId))
  },
  [QUEUE_REMOVE]: (sock, { payload }, acknowledge) => {
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
    emitToRoom(sock, QUEUE_PUSH, Queue.get(sock.user.roomId))
  },
} satisfies SocketHandlerMap

export default ACTION_HANDLERS
