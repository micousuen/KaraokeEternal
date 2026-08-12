import { describe, expect, it } from 'vitest'
import { getPhysicalAudioTrack } from './router.js'

describe('getPhysicalAudioTrack', () => {
  it('uses the assumed logical order when classification is unknown', () => {
    expect(getPhysicalAudioTrack(0, 2, null)).toBe(0)
    expect(getPhysicalAudioTrack(1, 2, null)).toBe(1)
  })

  it('flips physical streams when A1 is detected as instrumental', () => {
    expect(getPhysicalAudioTrack(0, 2, 0)).toBe(1)
    expect(getPhysicalAudioTrack(1, 2, 0)).toBe(0)
  })

  it('keeps physical streams when A2 is detected as instrumental', () => {
    expect(getPhysicalAudioTrack(0, 2, 1)).toBe(0)
    expect(getPhysicalAudioTrack(1, 2, 1)).toBe(1)
  })

  it('always serves the only physical stream for one-track media', () => {
    expect(getPhysicalAudioTrack(0, 1, null)).toBe(0)
    expect(getPhysicalAudioTrack(1, 1, null)).toBe(0)
  })

  it('rejects invalid logical tracks', () => {
    expect(getPhysicalAudioTrack(2, 2, 1)).toBeNull()
  })
})
