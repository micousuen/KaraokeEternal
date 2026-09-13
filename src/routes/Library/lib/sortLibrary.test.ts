import { describe, expect, it } from 'vitest'
import type { Artist, Song } from 'shared/types'
import { sortArtistIds, sortSongIds } from './sortLibrary'

describe('library ordering', () => {
  const artists = {
    1: artist(1, 'Adele', 4, 'Adele', 'A'),
    2: artist(2, '周杰倫', 12, 'ZhouJieLun', 'Z'),
    3: artist(3, 'Beyoncé', 8, 'Beyonce', 'B'),
  }

  it('orders artists by romanized name', () => {
    expect(sortArtistIds([2, 3, 1], artists, 'alphabetical')).toEqual([1, 3, 2])
  })

  it('orders artists by the sum of their song requests', () => {
    expect(sortArtistIds([1, 2, 3], artists, 'requested')).toEqual([2, 3, 1])
  })

  it('keeps artists with no requests in romanized alphabetical order at the end', () => {
    const unrequestedArtists = {
      1: artist(1, 'Popular', 2, 'Popular', 'P'),
      2: artist(2, '周杰倫', 0, 'ZhouJieLun', 'Z'),
      3: artist(3, 'Adele', 0, 'Adele', 'A'),
    }

    expect(sortArtistIds([1, 2, 3], unrequestedArtists, 'requested')).toEqual([1, 3, 2])
  })

  it('orders songs by request count and uses romanized names for ties', () => {
    const songs = {
      1: song(1, 5, 'Zhou', 'Z'),
      2: song(2, 9, 'Beyonce', 'B'),
      3: song(3, 9, 'Adele', 'A'),
    }
    expect(sortSongIds([1, 2, 3], songs, 'requested')).toEqual([3, 2, 1])
  })

  it('keeps songs with no requests in romanized alphabetical order at the end', () => {
    const songs = {
      1: song(1, 4, 'Popular', 'P'),
      2: song(2, 0, 'Zhou', 'Z'),
      3: song(3, 0, 'Adele', 'A'),
      4: song(4, 0, 'Beyonce', 'B'),
    }

    expect(sortSongIds([1, 2, 3, 4], songs, 'requested')).toEqual([1, 3, 4, 2])
  })
})

function artist (artistId: number, name: string, requestCount: number, sortKey: string, sortLetter: string): Artist {
  return { artistId, name, requestCount, sortKey, sortLetter, songIds: [] }
}

function song (songId: number, requestCount: number, sortKey: string, sortLetter: string): Song {
  return {
    artistId: 1,
    duration: 180,
    language: null,
    numMedia: 1,
    requestCount,
    songId,
    sortKey,
    sortLetter,
    title: sortKey,
  }
}
