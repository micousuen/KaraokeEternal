interface Presence {
  roomId: number
  userId: number
}

const sockets = new Map<string, Presence>()
const roomUsers = new Map<number, Map<number, Set<string>>>()
const userRooms = new Map<number, Map<number, Set<string>>>()

export function registerPresence (socketId: string, userId: number, roomId: number): void {
  releasePresence(socketId)
  sockets.set(socketId, { userId, roomId })
  addSocket(roomUsers, roomId, userId, socketId)
  addSocket(userRooms, userId, roomId, socketId)
}

export function releasePresence (socketId: string): void {
  const presence = sockets.get(socketId)
  if (!presence) return
  sockets.delete(socketId)
  removeSocket(roomUsers, presence.roomId, presence.userId, socketId)
  removeSocket(userRooms, presence.userId, presence.roomId, socketId)
}

export function countRoomUsers (roomId: number): number {
  return roomUsers.get(roomId)?.size || 0
}

export function getUserRooms (userId: number): number[] {
  return [...(userRooms.get(userId)?.keys() || [])]
}

function addSocket (
  index: Map<number, Map<number, Set<string>>>,
  ownerId: number,
  memberId: number,
  socketId: string,
): void {
  const members = index.get(ownerId) || new Map<number, Set<string>>()
  const memberSockets = members.get(memberId) || new Set<string>()
  memberSockets.add(socketId)
  members.set(memberId, memberSockets)
  index.set(ownerId, members)
}

function removeSocket (
  index: Map<number, Map<number, Set<string>>>,
  ownerId: number,
  memberId: number,
  socketId: string,
): void {
  const members = index.get(ownerId)
  const memberSockets = members?.get(memberId)
  if (!members || !memberSockets) return
  memberSockets.delete(socketId)
  if (memberSockets.size === 0) members.delete(memberId)
  if (members.size === 0) index.delete(ownerId)
}
