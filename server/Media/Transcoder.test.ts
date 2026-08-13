import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { temporaryArtifactPath } from './Transcoder.js'

describe('temporaryArtifactPath', () => {
  it.each(['audio.mp3', 'audio.m4a', 'video.mp4'])('keeps the output extension for FFmpeg: %s', (name) => {
    const output = path.join('/cache', name)
    const temporary = temporaryArtifactPath(output)

    expect(path.dirname(temporary)).toBe('/cache')
    expect(path.extname(temporary)).toBe(path.extname(output))
    expect(path.basename(temporary)).toMatch(new RegExp(`^${path.basename(name, path.extname(name))}\\.partial-`))
  })
})
