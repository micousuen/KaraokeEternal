import { createSelector } from '@reduxjs/toolkit'
import { RootState } from 'store/store'
import { sortSongIds } from '../lib/sortLibrary'

const getDownloads = createSelector(
  [
    (state: RootState) => state.songs,
  ],
  (songs) => {
    const downloadedIds = songs.result.filter(songId => !!songs.entities[songId]?.isManagedDownload)
    return sortSongIds(downloadedIds, songs.entities, 'downloads')
  },
)

export default getDownloads
