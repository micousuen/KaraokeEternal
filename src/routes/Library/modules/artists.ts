import { createAction, createReducer } from '@reduxjs/toolkit'
import { Artist } from 'shared/types'
import {
  LIBRARY_PUSH,
  LIBRARY_SCAN_BATCH,
} from 'shared/actionTypes'

const libraryPush = createAction<{
  artists: ArtistsState
}>(LIBRARY_PUSH)
const libraryScanBatch = createAction<{ artists: ArtistsState }>(LIBRARY_SCAN_BATCH)

// ------------------------------------
// Reducer
// ------------------------------------
interface ArtistsState {
  result: number[]
  entities: Record<number, Artist>
}

const initialState: ArtistsState = {
  result: [],
  entities: {},
}

const artistsReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(libraryPush, (_, { payload }) => ({
      result: payload.artists.result,
      entities: payload.artists.entities,
    }))
    .addCase(libraryScanBatch, (state, { payload }) => {
      for (const artistId of payload.artists.result) {
        const incoming = payload.artists.entities[artistId]
        const existing = state.entities[artistId]

        if (!existing) {
          state.result.push(artistId)
          state.entities[artistId] = incoming
        } else {
          existing.name = incoming.name
          existing.songIds = [...new Set([...existing.songIds, ...incoming.songIds])]
        }
      }
    })
})

export default artistsReducer
