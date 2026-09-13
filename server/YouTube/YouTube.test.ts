import { describe, expect, it } from 'vitest'
import { normalizeYouTubeUrl, parseYouTubeSearchResults, songNamingInput } from './YouTube.js'
import type { YouTubeJob } from '../../shared/types.js'

describe('normalizeYouTubeUrl', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?t=20',
    'https://m.youtube.com/shorts/dQw4w9WgXcQ',
    'https://youtube.com/live/dQw4w9WgXcQ',
  ])('accepts a YouTube video URL: %s', (url) => {
    expect(normalizeYouTubeUrl(url)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it.each([
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'http://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/playlist?list=123',
    'not a url',
  ])('rejects unsupported input: %s', (url) => {
    expect(() => normalizeYouTubeUrl(url)).toThrow()
  })
})

describe('parseYouTubeSearchResults', () => {
  it('returns safe preview metadata and excludes live or overlong videos', () => {
    const output = JSON.stringify({
      entries: [
        { id: 'dQw4w9WgXcQ', title: ' A song ', channel: 'An artist', duration: 213 },
        { id: 'abcdefghijk', title: 'Live song', duration: 120, live_status: 'is_live' },
        { id: 'lmnopqrstuv', title: 'Long song', duration: 301 },
        { id: '../not-safe', title: 'Invalid ID', duration: 100 },
      ],
    })

    expect(parseYouTubeSearchResults(output, 300)).toEqual([{
      channel: 'An artist',
      duration: 213,
      id: 'dQw4w9WgXcQ',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
      title: 'A song',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    }])
  })

  it('keeps results whose duration is unavailable', () => {
    const output = JSON.stringify({ entries: [{ id: 'dQw4w9WgXcQ', title: 'Song' }] })
    expect(parseYouTubeSearchResults(output, 300)[0].duration).toBeNull()
  })

  it('rejects malformed yt-dlp output', () => {
    expect(() => parseYouTubeSearchResults('not json', 300)).toThrow('invalid search response')
  })

  it('does not impose a fixed ten-result parsing cap', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: `video${String(index).padStart(6, '0')}`,
      title: `Song ${index}`,
      duration: 120,
    }))
    expect(parseYouTubeSearchResults(JSON.stringify({ entries }), 300)).toHaveLength(12)
  })
})

describe('songNamingInput', () => {
  it('uses the video title when it is known', () => {
    expect(songNamingInput({ title: 'Queen  Bohemian\nRhapsody Karaoke HD' } as YouTubeJob))
      .toBe('Queen Bohemian Rhapsody Karaoke HD')
  })

  it('falls back to the downloaded filename when the title is unknown', () => {
    expect(songNamingInput({
      title: 'YouTube video',
      file: '/media/downloads/YouTube-Some Song-YouTube [dQw4w9WgXcQ].mp4',
    } as YouTubeJob)).toBe('Some Song')
  })

  it('returns an empty string when nothing is known', () => {
    expect(songNamingInput({ title: 'YouTube video' } as YouTubeJob)).toBe('')
  })
})
