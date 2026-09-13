import anyAscii from 'any-ascii'

export interface LibrarySortMetadata {
  sortKey: string
  sortLetter: string
}

/** Build a stable Latin-script key for alphabetic library browsing. */
export function getLibrarySortMetadata (value: string): LibrarySortMetadata {
  const transliterated = anyAscii(value).trim()
  const sortKey = transliterated || value.trim()
  const firstAlphaNumeric = sortKey.match(/[A-Za-z0-9]/)?.[0]?.toUpperCase()

  return {
    sortKey,
    sortLetter: firstAlphaNumeric && /[A-Z]/.test(firstAlphaNumeric) ? firstAlphaNumeric : '#',
  }
}

export function compareLibrarySortMetadata (
  left: LibrarySortMetadata,
  right: LibrarySortMetadata,
): number {
  const leftBucket = left.sortLetter === '#' ? 0 : left.sortLetter.charCodeAt(0) - 64
  const rightBucket = right.sortLetter === '#' ? 0 : right.sortLetter.charCodeAt(0) - 64
  return leftBucket - rightBucket || left.sortKey.localeCompare(right.sortKey, 'en', {
    numeric: true,
    sensitivity: 'base',
  })
}
