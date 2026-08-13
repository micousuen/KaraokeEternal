import type { PlaybackStatus } from '../../shared/types.js'

interface PlayerSession {
  socketId: string
  status?: PlaybackStatus
}

const players = new Map<number, PlayerSession>()

export function claimPlayer (roomId: number, socketId: string): string | undefined {
  const previous = players.get(roomId)?.socketId
  players.set(roomId, { socketId })
  return previous === socketId ? undefined : previous
}

export function updatePlayerStatus (roomId: number, socketId: string, status: PlaybackStatus): boolean {
  const player = players.get(roomId)
  if (player?.socketId !== socketId) return false
  player.status = status
  return true
}

export function updatePlayerPosition (roomId: number, socketId: string, position: number): boolean {
  const player = players.get(roomId)
  if (player?.socketId !== socketId) return false
  if (player.status) player.status = { ...player.status, position }
  return true
}

export function getPlayerStatus (roomId: number): PlaybackStatus | undefined {
  return players.get(roomId)?.status
}

export function releasePlayer (roomId: number, socketId: string): boolean {
  if (players.get(roomId)?.socketId !== socketId) return false
  players.delete(roomId)
  return true
}

export function isActivePlayer (roomId: number, socketId: string): boolean {
  return players.get(roomId)?.socketId === socketId
}
