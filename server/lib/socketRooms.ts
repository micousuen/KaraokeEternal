export const ADMIN_SOCKETS = 'ADMINS'

export const userSockets = (userId: number): string => `USER_ID_${userId}`
export const roomSockets = (roomId: number): string => `ROOM_ID_${roomId}`
export const roomAdminSockets = (roomId: number): string => `ROOM_ID_${roomId}_ADMINS`

export async function joinIdentityRooms (socket): Promise<void> {
  const { user } = socket
  const rooms: string[] = []
  if (typeof user?.userId === 'number') rooms.push(userSockets(user.userId))
  if (user?.isAdmin) rooms.push(ADMIN_SOCKETS)
  if (typeof user?.roomId === 'number') {
    rooms.push(roomSockets(user.roomId))
    if (user.isAdmin) rooms.push(roomAdminSockets(user.roomId))
  }
  if (rooms.length) await socket.join(rooms)
}
