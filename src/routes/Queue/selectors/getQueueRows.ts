import { createSelector } from '@reduxjs/toolkit'
import { ensureState } from 'redux-optimistic-ui'
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
    (state: RootState) => ensureState(state.userStars).starredSongs,
    (state: RootState) => state.starCounts,
    (state: RootState) => state.user.userId,
  ],
  (queue, playerHistory, artists, songs, status, starredSongs, starCounts, userId) => {
    const wasPlayed = (queueId: number) => queue.entities[queueId].isPlayed || playerHistory.includes(queueId)
    const activeIds = queue.result.filter(queueId => !wasPlayed(queueId))
    const playedIds = queue.result.filter(wasPlayed).reverse()
    const rows: Record<number, QueueRowModel> = {}

    for (const queueId of queue.result) {
      const item = queue.entities[queueId]
      const song = songs.entities[item.songId]
      const isCurrent = queueId === status.queueId && !status.isAtQueueEnd
      const state: QueueRowState = isCurrent ? 'current' : wasPlayed(queueId) ? 'played' : 'upcoming'

      rows[queueId] = {
        ...item,
        artist: artists.entities[song.artistId].name,
        duration: song.duration,
        errorMessage: isCurrent ? status.errorMessage || '' : '',
        isErrored: isCurrent && status.isErrored,
        isOwner: item.userId === userId,
        isPlaying: isCurrent && status.isPlaying,
        isStarred: starredSongs.includes(item.songId),
        pctPlayed: isCurrent && song.duration ? status.position / song.duration * 100 : 0,
        starCount: starCounts.songs[item.songId] || 0,
        state,
        title: song.title,
      }
    }

    return {
      activeIds,
      currentQueueId: status.queueId,
      playedIds,
      queue,
      rows,
    }
  },
)

export default getQueueRows
