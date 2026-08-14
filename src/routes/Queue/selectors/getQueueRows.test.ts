import { describe, expect, it } from 'vitest'
import type { RootState } from 'store/store'
import type { QueueItem } from 'shared/types'
import getQueueRows from './getQueueRows'

describe('getQueueRows', () => {
  it('keeps the queue renderable while its library metadata is loading', () => {
    const row = getQueueRows(state({ songs: {}, artists: {} })).rows[1]

    expect(row).toEqual(expect.objectContaining({
      artist: '',
      duration: 0,
      title: 'Loading song…',
    }))
  })

  it('renders available song metadata before its artist arrives', () => {
    const row = getQueueRows(state({
      songs: { 10: { artistId: 20, duration: 180, title: 'Safe & Sound' } },
      artists: {},
    })).rows[1]

    expect(row).toEqual(expect.objectContaining({
      artist: '',
      duration: 180,
      title: 'Safe & Sound',
    }))
  })
})

function state ({ songs, artists }: {
  songs: Record<number, { artistId: number, duration: number, title: string }>
  artists: Record<number, { name: string }>
}): RootState {
  const item: QueueItem = {
    queueId: 1,
    songId: 10,
    userId: 1,
    prevQueueId: null,
    mediaId: 10,
    rgTrackGain: 0,
    rgTrackPeak: 1,
    userDateUpdated: 1,
    userDisplayName: 'Singer',
    isPlayed: false,
    isVideoKeyingEnabled: false,
  }
  return {
    queue: { result: [1], entities: { 1: item }, revision: 1, isLoading: false },
    status: {
      history: [],
      queueId: 1,
      isAtQueueEnd: false,
      isErrored: false,
      isPlaying: true,
      errorMessage: null,
      position: 10,
    },
    songs: { result: Object.keys(songs).map(Number), entities: songs },
    artists: { result: Object.keys(artists).map(Number), entities: artists },
    userStars: { starredSongs: [] },
    starCounts: { songs: {} },
    user: { userId: 1 },
  } as unknown as RootState
}
