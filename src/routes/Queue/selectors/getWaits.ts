import { RootState } from 'store/store'
import { createSelector } from '@reduxjs/toolkit'
import getActiveQueue from './getActiveQueue'

const getPosition = (state: RootState) => state.status.position
const getDuration = (state: RootState) => state.status.duration
const getQueue = (state: RootState) => getActiveQueue(state)
const getQueueId = (state: RootState) => state.status.queueId
const getSongs = (state: RootState) => state.songs

const getWaits = createSelector(
  [getQueue, getQueueId, getPosition, getDuration, getSongs],
  calculateWaits,
)

export default getWaits

interface WaitQueue {
  result: number[]
  entities: Record<number, { songId: number }>
}

interface WaitSongs {
  entities: Record<number, { duration: number }>
}

export function calculateWaits (
  queue: WaitQueue,
  currentQueueId: number,
  position: number,
  playerDuration: number,
  songs: WaitSongs,
): Record<number, number> {
  const waits: Record<number, number> = {}
  const currentIndex = queue.result.indexOf(currentQueueId)
  let wait = 0

  for (let index = 0; index < queue.result.length; index++) {
    const queueId = queue.result[index]
    const song = songs.entities[queue.entities[queueId]?.songId]
    if (!song) continue

    const scannedDuration = Number.isFinite(song.duration) ? Math.max(0, song.duration) : 0

    if (index === currentIndex) {
      waits[queueId] = 0
      const currentDuration = Number.isFinite(playerDuration) && playerDuration > 0
        ? playerDuration
        : scannedDuration
      const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0
      wait = Math.max(0, Math.round(currentDuration - safePosition))
    } else if (currentIndex === -1 || index > currentIndex) {
      waits[queueId] = wait
      wait += Math.round(scannedDuration)
    } else {
      waits[queueId] = 0
    }
  }

  return waits
}
