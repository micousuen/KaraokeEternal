import { createSelector } from '@reduxjs/toolkit'
import { RootState } from 'store/store'
import { sortArtistIds } from '../lib/sortLibrary'

const getOrderedArtistIds = createSelector(
  [
    (state: RootState) => state.artists,
    (state: RootState) => state.library.sortMode,
  ],
  (artists, sortMode) => sortArtistIds(artists.result, artists.entities, sortMode),
)

export default getOrderedArtistIds
