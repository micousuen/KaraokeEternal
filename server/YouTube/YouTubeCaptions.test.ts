import { describe, expect, it } from 'vitest'
import { selectCreatorCaption, youtubeVideoIdFromFilename } from './YouTubeCaptions.js'

describe('YouTube creator captions', () => {
  it('extracts the source video ID from an unrenamed managed download', () => {
    expect(youtubeVideoIdFromFilename('/downloads/YouTube-Song-YouTube [aJOTlE1K90k].mp4'))
      .toBe('aJOTlE1K90k')
    expect(youtubeVideoIdFromFilename('/downloads/Artist-Song.mp4')).toBeUndefined()
  })

  it('chooses a manual SRT and reduces its track key to an alignment language', () => {
    expect(selectCreatorCaption([
      'unrelated.srt',
      'youtube-creator-caption.en-nP7-2PuUl7o.srt',
    ], '/tmp/work')).toEqual({
      file: '/tmp/work/youtube-creator-caption.en-nP7-2PuUl7o.srt',
      language: 'en',
    })
  })

  it('defers to WhisperX when manual captions contain multiple languages', () => {
    expect(selectCreatorCaption([
      'youtube-creator-caption.en.srt',
      'youtube-creator-caption.es.srt',
    ], '/tmp/work')).toBeUndefined()
  })
})
