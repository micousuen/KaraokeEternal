import { createAction, createAsyncThunk, createReducer, type UnknownAction } from '@reduxjs/toolkit'
import { REHYDRATE } from 'redux-persist'
import {
  ACCOUNT_RECEIVE,
  STAR_SONG,
  UNSTAR_SONG,
  SONG_STARRED,
  SONG_UNSTARRED,
  STARS_PUSH,
  SOCKET_AUTH_ERROR,
  LOGOUT,
  USER_STAR_CHANGED,
} from 'shared/actionTypes'
import { RootState } from 'store/store'

// ------------------------------------
// Actions
// ------------------------------------
export const toggleSongStarred = createAsyncThunk<void, number, { state: RootState }>(
  'userStars/toggleSongStarred',
  async (songId, { dispatch, getState }) => {
    const starredSongs = getState().userStars.starredSongs
    if (starredSongs.includes(songId)) {
      dispatch(unstarSong(songId))
    } else {
      dispatch(starSong(songId))
    }
  },
)

const starSong = createAction(STAR_SONG, (songId: number) => ({
  payload: { songId },
  meta: { isOptimistic: true },
}))

const unstarSong = createAction(UNSTAR_SONG, (songId: number) => ({
  payload: { songId },
  meta: { isOptimistic: true },
}))

const songStarred = createAction<{ userId: number, songId: number }>(SONG_STARRED)
const songUnstarred = createAction<{ userId: number, songId: number }>(SONG_UNSTARRED)
const starsPush = createAction<UserStarsState>(STARS_PUSH) // @todo Seems to be unused
const accountReceive = createAction<{ userId: number }>(ACCOUNT_RECEIVE)
const userStarChanged = createAction<{ songId: number, starred: boolean }>(USER_STAR_CHANGED)

// ------------------------------------
// Reducer
// ------------------------------------
interface UserStarsState {
  userId: number | null
  starredArtists: number[]
  starredSongs: number[]
}

const initialState: UserStarsState = {
  userId: null,
  starredArtists: [],
  starredSongs: [],
}

const userStarsReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(starSong, (state, { payload }) => {
      // optimistic
      state.starredSongs.push(payload.songId)
    })
    .addCase(unstarSong, (state, { payload }) => {
      // optimistic
      state.starredSongs.splice(state.starredSongs.indexOf(payload.songId), 1)
    })
    .addCase(songStarred, (state, { payload }) => {
      if (payload.userId === state.userId && !state.starredSongs.includes(payload.songId)) {
        state.starredSongs.push(payload.songId)
      }
    })
    .addCase(songUnstarred, (state, { payload }) => {
      if (payload.userId === state.userId && state.starredSongs.includes(payload.songId)) {
        state.starredSongs.splice(state.starredSongs.indexOf(payload.songId), 1)
      }
    })
    .addCase(starsPush, (state, { payload }) => ({
      ...state,
      ...payload,
    }))
    .addCase(accountReceive, (state, { payload }) => {
      state.userId = payload.userId
    })
    .addCase(userStarChanged, (state, { payload }) => {
      if (payload.starred && !state.starredSongs.includes(payload.songId)) state.starredSongs.push(payload.songId)
      if (!payload.starred) removeSong(state.starredSongs, payload.songId)
    })
    // @ts-expect-error: payload exists; action type appears to be erroneous
    .addCase(REHYDRATE, (state, { payload }) => {
      if (typeof payload?.userId === 'number') {
        state.userId = payload.userId
      }
    })
    .addCase(LOGOUT, () => ({
      ...initialState,
    }))
    .addCase(SOCKET_AUTH_ERROR, () => ({
      ...initialState,
    }))
    .addMatcher(isStarError, (state, action) => {
      const original = action.meta?.optimisticAction
      const songId = (original?.payload as { songId?: unknown } | undefined)?.songId
      if (typeof songId !== 'number') return
      if (original?.type === STAR_SONG) removeSong(state.starredSongs, songId)
      if (original?.type === UNSTAR_SONG && !state.starredSongs.includes(songId)) state.starredSongs.push(songId)
    })
})

function removeSong (songs: number[], songId: number): void {
  const index = songs.indexOf(songId)
  if (index >= 0) songs.splice(index, 1)
}

function isStarError (action: UnknownAction): action is UnknownAction & {
  meta?: { optimisticAction?: { payload?: unknown, type?: string } }
} {
  return action.type === `${STAR_SONG}_ERROR` || action.type === `${UNSTAR_SONG}_ERROR`
}

export default userStarsReducer
