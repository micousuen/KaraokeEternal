import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from 'store/store'

const getStarredSongs = (state: RootState) => state.userStars.starredSongs

const getStarredSongSet = createSelector(
  [getStarredSongs],
  starredSongs => new Set(starredSongs),
)

export default getStarredSongSet
