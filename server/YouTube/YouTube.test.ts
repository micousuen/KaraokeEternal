import { describe, expect, it } from 'vitest'
import { normalizeYouTubeUrl } from './YouTube.js'

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
