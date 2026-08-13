import { createAction, createReducer } from '@reduxjs/toolkit'
import {
  SONG_STARRED,
  SONG_UNSTARRED,
  STAR_COUNTS_PUSH,
  STAR_COUNT_CHANGED,
} from 'shared/actionTypes'

const songStarred = createAction<{ songId: number }>(SONG_STARRED)
const songUnstarred = createAction<{ songId: number }>(SONG_UNSTARRED)
const starCountsPush = createAction<StarCountsState>(STAR_COUNTS_PUSH)
const starCountChanged = createAction<{ songId: number, delta: -1 | 1, version: number }>(STAR_COUNT_CHANGED)

// ------------------------------------
// Reducer
// ------------------------------------
interface StarCountsState {
  artists: Record<number, number>
  songs: Record<number, number>
  version: number
}

const initialState: StarCountsState = {
  artists: {},
  songs: {},
  version: 0,
}

const starCountsReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(songStarred, (state, { payload }) => {
      state.songs[payload.songId] = state.songs[payload.songId] + 1 || 1
    })
    .addCase(songUnstarred, (state, { payload }) => {
      state.songs[payload.songId] = Math.max(state.songs[payload.songId] - 1, 0)
    })
    .addCase(starCountsPush, (_, { payload }) => ({
      ...payload,
    }))
    .addCase(starCountChanged, (state, { payload }) => {
      state.songs[payload.songId] = Math.max((state.songs[payload.songId] || 0) + payload.delta, 0)
      state.version = payload.version
    })
})

export default starCountsReducer
