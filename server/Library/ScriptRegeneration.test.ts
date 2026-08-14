import { describe, expect, it } from 'vitest'
import { findScriptRegenerationCandidates } from './ScriptRegeneration.js'

describe('findScriptRegenerationCandidates', () => {
  it('selects one existing scripted video per song and prefers preferred media', () => {
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
})

function media (mediaId: number, songId: number, relPath: string, isPreferred: boolean) {
  return {
    isPreferred,
    mediaId,
    path: '/library',
    pathId: 1,
    relPath,
    songId,
  }
}
