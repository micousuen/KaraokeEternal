import { createSelector } from '@reduxjs/toolkit'
import { RootState } from 'store/store'
import getOrderedArtistIds from './getOrderedArtistIds'

const getArtists = (state: RootState) => state.artists

const getAlphaPickerMap = createSelector(
  [getArtists, getOrderedArtistIds],
  (artists, artistIds) => {
    const map: Record<string, number> = { '#': 0 } // letters to row numbers
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    let c = 0

    artistIds.forEach((artistId, i) => {
      const char = artists.entities[artistId].sortLetter
      const distance = chars.indexOf(char) - c

      if (distance >= 0) {
        c += distance
        map[chars[c]] = i
        c++
      }
    })

    return map
  })

export default getAlphaPickerMap
