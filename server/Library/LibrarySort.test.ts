import { describe, expect, it } from 'vitest'
import { getLibrarySortMetadata } from './LibrarySort.js'

describe('library romanized sort metadata', () => {
  it.each([
    ['周杰倫', 'Z'],
    ['あいみょん', 'A'],
    ['아이유', 'A'],
    ['Beyoncé', 'B'],
    ['22', '#'],
  ])('places %s in the %s picker bucket', (value, letter) => {
    expect(getLibrarySortMetadata(value).sortLetter).toBe(letter)
  })
})
