import Rooms from './Rooms.js'
import {
  ROOM_PREFS_PUSH_REQUEST,
  ROOM_PREFS_PUSH,
} from '../../shared/actionTypes.js'
import { emitAction, requireAdmin } from '../lib/socketActions.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'

const ACTION_HANDLERS = {
  [ROOM_PREFS_PUSH_REQUEST]: async (sock, { payload }, acknowledge) => {
    const { roomId } = payload

    if (!requireAdmin(sock, acknowledge, ROOM_PREFS_PUSH_REQUEST)) return
    if (!roomId) throw new Error('A room is required')

    const sockets = await sock.server.in(Rooms.prefix(roomId)).fetchSockets()

    for (const s of sockets) {
      if (s?.user.isAdmin) {
        emitAction(sock.server.to(s.id), ROOM_PREFS_PUSH, payload)
      }
    }
  },
} satisfies SocketHandlerMap

export default ACTION_HANDLERS
