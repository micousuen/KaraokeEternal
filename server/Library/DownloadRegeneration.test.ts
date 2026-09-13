import { describe, expect, it } from 'vitest'
import {
  findInstrumentalRegenerationCandidates,
  findNameReparsingCandidates,
  findScriptRegenerationCandidates,
} from './DownloadRegeneration.js'

describe('findScriptRegenerationCandidates', () => {
  it('selects one existing scripted download per song and prefers preferred media', () => {
    const candidates = findScriptRegenerationCandidates({
      result: [1, 2, 3, 4],
      entities: {
        1: media(1, 10, 'first.mp4', false),
        2: media(2, 10, 'preferred.mkv', true),
        3: media(3, 20, 'audio.mp3', true),
        4: media(4, 30, 'no-script.mp4', true),
      },
    }, filename => !filename.endsWith('no-script.srt'))

    expect(candidates).toEqual([expect.objectContaining({
      mediaId: 2,
      songId: 10,
      source: '/library/preferred.mkv',
    })])
  })

  it('ignores media that is not a managed download', () => {
    const candidates = findScriptRegenerationCandidates({
      result: [1, 2],
      entities: {
        1: { ...media(1, 10, 'library-song.mp4', true), isManagedDownload: 0, pathData: '{}' },
        2: media(2, 20, 'YouTube-Song-YouTube [12345678901].mp4', true),
      },
    }, () => true)

    expect(candidates).toEqual([expect.objectContaining({ mediaId: 2, songId: 20 })])
  })

  it('treats a managed download path as managed even without the media flag', () => {
    const candidates = findScriptRegenerationCandidates({
      result: [1],
      entities: {
        1: { ...media(1, 10, 'Renamed-Title.mp4', true), isManagedDownload: 0, pathData: '{"isManagedDownloadPath":true}' },
      },
    }, () => true)

    expect(candidates).toEqual([expect.objectContaining({ mediaId: 1, songId: 10 })])
  })
})

describe('findInstrumentalRegenerationCandidates', () => {
  it('selects download videos per song without requiring an existing script', () => {
    const candidates = findInstrumentalRegenerationCandidates({
      result: [1, 2, 3],
      entities: {
        1: media(1, 10, 'no-script-yet.mp4', true),
        2: media(2, 20, 'audio.mp3', true),
        3: { ...media(3, 30, 'library-song.mp4', true), isManagedDownload: 0, pathData: '{}' },
      },
    })

    expect(candidates).toEqual([expect.objectContaining({ mediaId: 1, songId: 10 })])
  })
})

describe('findNameReparsingCandidates', () => {
  it('selects download-only songs that still carry a YouTube filename', () => {
    const songIds = findNameReparsingCandidates({
      result: [1, 2, 3, 4],
      entities: {
        1: media(1, 10, 'YouTube-Song-YouTube [12345678901].mp4', true),
        2: media(2, 20, 'Artist-Title.mp4', true),
        3: media(3, 30, 'YouTube-Other-YouTube [abcdefghijk].mkv', false),
        4: { ...media(4, 40, 'Library-Only.mp4', true), isManagedDownload: 0, pathData: '{}' },
      },
    })

    expect(songIds).toEqual([10, 30])
  })

  it('excludes songs that mix download and library media', () => {
    const songIds = findNameReparsingCandidates({
      result: [1, 2],
      entities: {
        1: media(1, 10, 'YouTube-Song-YouTube [12345678901].mp4', false),
        2: { ...media(2, 10, 'Artist-Title.mp4', true), isManagedDownload: 0, pathData: '{}' },
      },
    })

    expect(songIds).toEqual([])
  })
})

function media (mediaId: number, songId: number, relPath: string, isPreferred: boolean) {
  return {
    isManagedDownload: 1,
    isPreferred,
    mediaId,
    path: '/library',
    pathData: '{"isManagedDownloadPath":true}',
    pathId: 1,
    relPath,
    songId,
  }
}
