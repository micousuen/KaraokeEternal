import { describe, expect, it } from 'vitest'
import parseFilename from './parseFilename.js'

describe('parseFilename', () => {
  it('parses singer-song-language filenames', () => {
    expect(parseFilename('Adele-Hello-English', 'artist-title-language')).toEqual({
      artist: 'Adele',
      title: 'Hello',
      language: 'English',
    })
  })

  it('keeps multiple singers as one artist value', () => {
    expect(parseFilename('Singer One Singer Two-Duet Song-English', 'artist-title-language')).toEqual({
      artist: 'Singer One Singer Two',
      title: 'Duet Song',
      language: 'English',
    })
  })

  it('keeps inner hyphens in the song title', () => {
    expect(parseFilename('Singer-Song - Live-Version-Chinese', 'artist-title-language')).toEqual({
      artist: 'Singer',
      title: 'Song - Live - Version',
      language: 'Chinese',
    })
  })

  it('rejects incomplete filenames', () => {
    expect(() => parseFilename('Singer-Song', 'artist-title-language'))
      .toThrow('expected filename format: singer-song-language')
  })
})
