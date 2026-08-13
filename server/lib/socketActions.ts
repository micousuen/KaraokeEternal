import { _ERROR } from '../../shared/actionTypes.js'
import type { SocketAcknowledge } from '../../shared/socketProtocol.js'
import { roomSockets } from './socketRooms.js'

export function requireAdmin (socket, acknowledge?: SocketAcknowledge, requestType?: string): boolean {
  if (socket.user?.isAdmin) return true
  if (acknowledge && requestType) {
    acknowledge({ type: requestType + _ERROR, error: 'Unauthorized' })
    return false
  }
  throw new Error('Administrator access is required')
}

export function emitAction (target, type: string, payload?: unknown): void {
  target.emit('action', payload === undefined ? { type } : { type, payload })
}

export function emitToRoom (socket, type: string, payload?: unknown): void {
  emitAction(socket.server.to(roomSockets(socket.user.roomId)), type, payload)
}

export function relayToRoom (type: string) {
  return (socket, action: { payload?: unknown }) => emitToRoom(socket, type, action.payload)
}
