import {
  ROOM_PREFS_PUSH_REQUEST,
  ROOM_PREFS_PUSH,
} from '../../shared/actionTypes.js'
import { emitAction, requireAdmin } from '../lib/socketActions.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'
import { roomAdminSockets } from '../lib/socketRooms.js'

const ACTION_HANDLERS = {
  [ROOM_PREFS_PUSH_REQUEST]: async (sock, { payload }, acknowledge) => {
    const { roomId } = payload

    if (!requireAdmin(sock, acknowledge, ROOM_PREFS_PUSH_REQUEST)) return
    if (!roomId) throw new Error('A room is required')

    emitAction(sock.server.to(roomAdminSockets(roomId)), ROOM_PREFS_PUSH, payload)
  },
} satisfies SocketHandlerMap

export default ACTION_HANDLERS
