import { createAction, createReducer } from '@reduxjs/toolkit'
import { Song } from 'shared/types'
import {
  LIBRARY_PUSH,
  LIBRARY_PUSH_SONG,
  LIBRARY_SCAN_BATCH,
} from 'shared/actionTypes'

const libraryPushSong = createAction<SongsState['entities'][number]>(LIBRARY_PUSH_SONG)
const libraryScanBatch = createAction<{ songs: SongsState }>(LIBRARY_SCAN_BATCH)
const libraryPush = createAction<{
  songs: SongsState
}>(LIBRARY_PUSH)

// ------------------------------------
// Reducer
// ------------------------------------
interface SongsState {
  result: number[]
  entities: Record<number, Song>
}

const initialState: SongsState = {
  result: [],
  entities: {},
}

const songsReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(libraryPush, (_, { payload }) => ({
      result: payload.songs.result,
      entities: payload.songs.entities,
    }))
    .addCase(libraryPushSong, (state, { payload }) => ({
      ...state,
      entities: {
        ...state.entities,
        ...payload,
      },
    }))
    .addCase(libraryScanBatch, (state, { payload }) => {
      for (const songId of payload.songs.result) {
        if (!state.entities[songId]) state.result.push(songId)
        state.entities[songId] = payload.songs.entities[songId]
      }
    })
})

export default songsReducer
