import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from 'store/store'
import type { QueueItem } from 'shared/types'
import getPlayerHistory from './getPlayerHistory'
import getRoundRobinQueue from './getRoundRobinQueue'

export type QueueRowState = 'current' | 'upcoming' | 'played'

export interface QueueRowModel extends QueueItem {
  artist: string
  duration: number
  errorMessage: string
  isErrored: boolean
  isOwner: boolean
  isPlaying: boolean
  isStarred: boolean
  pctPlayed: number
  starCount: number
  state: QueueRowState
  title: string
}

const getQueueRows = createSelector(
  [
    getRoundRobinQueue,
    getPlayerHistory,
    (state: RootState) => state.artists,
    (state: RootState) => state.songs,
    (state: RootState) => state.status,
    (state: RootState) => state.userStars.starredSongs,
    (state: RootState) => state.starCounts,
    (state: RootState) => state.user.userId,
  ],
  (queue, playerHistory, artists, songs, status, starredSongs, starCounts, userId) => {
    // Queue snapshots can arrive before the library HTTP snapshot on a new or
    // reconnected controller. Keep the queue usable while song metadata catches
    // up, and ignore a malformed result entry that has no queue entity.
    const queueIds = queue.result.filter(queueId => !!queue.entities[queueId])
    const visibleQueue = queueIds.length === queue.result.length ? queue : { ...queue, result: queueIds }
    const wasPlayed = (queueId: number) => queue.entities[queueId].isPlayed || playerHistory.includes(queueId)
    const activeIds = queueIds.filter(queueId => !wasPlayed(queueId))
    const playedIds = queueIds.filter(wasPlayed).reverse()
    const rows: Record<number, QueueRowModel> = {}

    for (const queueId of queueIds) {
      const item = queue.entities[queueId]
      const song = songs.entities[item.songId]
      const artist = song ? artists.entities[song.artistId] : undefined
      const isCurrent = queueId === status.queueId && !status.isAtQueueEnd
      const state: QueueRowState = isCurrent ? 'current' : wasPlayed(queueId) ? 'played' : 'upcoming'

      rows[queueId] = {
        ...item,
        artist: artist?.name || '',
        duration: song?.duration || 0,
        errorMessage: isCurrent ? status.errorMessage || '' : '',
        isErrored: isCurrent && status.isErrored,
        isOwner: item.userId === userId,
        isPlaying: isCurrent && status.isPlaying,
        isStarred: starredSongs.includes(item.songId),
        pctPlayed: isCurrent && song?.duration ? status.position / song.duration * 100 : 0,
        starCount: starCounts.songs[item.songId] || 0,
        state,
        title: song?.title || 'Loading song…',
      }
    }

    return {
      activeIds,
      currentQueueId: status.queueId,
      playedIds,
      queue: visibleQueue,
      rows,
    }
  },
)

export default getQueueRows
