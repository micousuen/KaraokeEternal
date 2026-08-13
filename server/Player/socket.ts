import Rooms from '../Rooms/Rooms.js'

import {
  PLAYER_CMD_NEXT,
  PLAYER_CMD_OPTIONS,
  PLAYER_CMD_PAUSE,
  PLAYER_CMD_PLAY,
  PLAYER_CMD_PRIORITY,
  PLAYER_CMD_REPLAY,
  PLAYER_CMD_SEEK,
  PLAYER_CMD_VOLUME,
  PLAYER_CMD_TAKEOVER,
  PLAYER_REQ_NEXT,
  PLAYER_REQ_OPTIONS,
  PLAYER_REQ_PAUSE,
  PLAYER_REQ_PLAY,
  PLAYER_REQ_PRIORITY,
  PLAYER_REQ_REPLAY,
  PLAYER_REQ_SEEK,
  PLAYER_REQ_VOLUME,
  PLAYER_EMIT_STATUS,
  PLAYER_EMIT_CLAIM,
  PLAYER_EMIT_LEAVE,
  PLAYER_STATUS,
  PLAYER_LEAVE,
  QUEUE_PUSH,
} from '../../shared/actionTypes.js'
import Queue from '../Queue/Queue.js'
import { emitToRoom, relayToRoom } from '../lib/socketActions.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [PLAYER_EMIT_CLAIM]: (sock) => {
    // Taking over is explicit and only happens when a player screen opens.
    // Routine playback/status updates must never transfer ownership.
    sock._isSuperseded = false

    for (const existing of sock.server.of('/').sockets.values()) {
      if (
        existing.id !== sock.id
        && existing.user?.roomId === sock.user.roomId
        && existing._lastPlayerStatus
        && !existing._isSuperseded
      ) {
        existing._isSuperseded = true
        existing._lastPlayerStatus = null
        existing.emit('action', { type: PLAYER_CMD_TAKEOVER })
      }
    }
  },
  [PLAYER_REQ_OPTIONS]: relayToRoom(PLAYER_CMD_OPTIONS),
  [PLAYER_REQ_NEXT]: relayToRoom(PLAYER_CMD_NEXT),
  [PLAYER_REQ_PAUSE]: relayToRoom(PLAYER_CMD_PAUSE),
  [PLAYER_REQ_PLAY]: relayToRoom(PLAYER_CMD_PLAY),
  [PLAYER_REQ_PRIORITY]: (sock, { payload }) => {
    const { queueId } = payload
    if (!Queue.isInRoom(queueId, sock.user.roomId)) throw new Error('Queue item is not in this room')

    emitToRoom(sock, PLAYER_CMD_PRIORITY, { queueId })
  },
  [PLAYER_REQ_REPLAY]: (sock, { payload }) => {
    if (!Queue.isInRoom(payload.queueId, sock.user.roomId)) {
      throw new Error('Queue item is not in this room')
    }

    emitToRoom(sock, PLAYER_CMD_REPLAY, payload)
  },
  [PLAYER_REQ_SEEK]: relayToRoom(PLAYER_CMD_SEEK),
  [PLAYER_REQ_VOLUME]: relayToRoom(PLAYER_CMD_VOLUME),
  [PLAYER_EMIT_STATUS]: (sock, { payload }) => {
    if (sock._isSuperseded) return

    const history = Array.isArray(payload.history)
      ? payload.history.filter(queueId => Number.isInteger(queueId))
      : []

    if (Queue.markPlayed(sock.user.roomId, history)) {
      sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
        type: QUEUE_PUSH,
        payload: Queue.get(sock.user.roomId),
      })
    }

    // so we can tell the room when players leave and
    // relay last known player status on client join
    sock._lastPlayerStatus = payload

    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: PLAYER_STATUS,
      payload,
    })
  },
  [PLAYER_EMIT_LEAVE]: (sock) => {
    sock._lastPlayerStatus = null

    // any players left in room?
    if (!Rooms.isPlayerPresent(sock.server, sock.user.roomId)) {
      sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
        type: PLAYER_LEAVE,
        payload: { socketId: sock.id },
      })
    }
  },
} satisfies SocketHandlerMap

export default ACTION_HANDLERS
