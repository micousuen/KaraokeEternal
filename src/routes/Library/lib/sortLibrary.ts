import type { Artist, Song } from 'shared/types'
import type { LibrarySortMode } from '../modules/library'

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function compareAlphabetical (
  left: Pick<Artist, 'sortKey' | 'sortLetter'> | Pick<Song, 'sortKey' | 'sortLetter'>,
  right: Pick<Artist, 'sortKey' | 'sortLetter'> | Pick<Song, 'sortKey' | 'sortLetter'>,
): number {
  const leftBucket = left.sortLetter === '#' ? 0 : left.sortLetter.charCodeAt(0) - 64
  const rightBucket = right.sortLetter === '#' ? 0 : right.sortLetter.charCodeAt(0) - 64
  return leftBucket - rightBucket || collator.compare(left.sortKey, right.sortKey)
}

function compareByMode<T extends { dateAdded?: number, requestCount: number, sortKey: string, sortLetter: string }> (
  left: T,
  right: T,
  mode: LibrarySortMode,
): number {
  if (mode === 'requested') return right.requestCount - left.requestCount || compareAlphabetical(left, right)
  if (mode === 'downloads') return (right.dateAdded || 0) - (left.dateAdded || 0) || compareAlphabetical(left, right)
  return compareAlphabetical(left, right)
}

export function sortArtistIds (
  artistIds: number[],
  artists: Record<number, Artist>,
  mode: LibrarySortMode,
): number[] {
  return [...artistIds].sort((leftId, rightId) =>
    compareByMode(artists[leftId], artists[rightId], mode) || leftId - rightId)
}

export function sortSongIds (
  songIds: number[],
  songs: Record<number, Song>,
  mode: LibrarySortMode,
): number[] {
  return [...songIds].sort((leftId, rightId) =>
    compareByMode(songs[leftId], songs[rightId], mode) || leftId - rightId)
}
