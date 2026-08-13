import { describe, expect, it } from 'vitest'
import { classifiedVocalTrack, planAutomaticMediaProcessing, planForcedMediaProcessing } from './MediaProcessingPolicy.js'

describe('classifiedVocalTrack', () => {
  it.each([
    [0, null, false, null],
    [1, null, false, 0],
    [2, 0, false, 1],
    [2, 1, false, 0],
    [2, null, false, null],
    [2, null, true, 0],
  ] as const)('maps count=%s ktv=%s fallback=%s to %s', (count, ktv, fallback, expected) => {
    expect(classifiedVocalTrack(count, ktv, fallback)).toBe(expected)
  })
})

describe('planAutomaticMediaProcessing', () => {
  it('processes and adds an instrumental for one-track media', () => {
    expect(planAutomaticMediaProcessing({ audioTrackCount: 1, ktvTrack: null, isManagedDownload: false }))
      .toEqual(expect.objectContaining({
        vocalTrack: 0,
        shouldSchedule: true,
        runSeparation: true,
        generateInstrumental: true,
        allowScript: true,
      }))
  })

  it('only classifies existing dual-track media', () => {
    expect(planAutomaticMediaProcessing({ audioTrackCount: 2, ktvTrack: 1, isManagedDownload: false }).shouldSchedule)
      .toBe(false)
  })

  it('separates and scripts the vocal track of managed dual-track downloads', () => {
    expect(planAutomaticMediaProcessing({ audioTrackCount: 2, ktvTrack: 0, isManagedDownload: true }))
      .toEqual(expect.objectContaining({
        vocalTrack: 1,
        shouldSchedule: true,
        runSeparation: true,
        generateInstrumental: false,
        allowScript: true,
      }))
  })

  it('does not guess a track for automatic dual-track processing', () => {
    expect(planAutomaticMediaProcessing({ audioTrackCount: 2, ktvTrack: null, isManagedDownload: true }).shouldSchedule)
      .toBe(false)
  })
})

describe('planForcedMediaProcessing', () => {
  it('forces script regeneration and falls back to A1', () => {
    expect(planForcedMediaProcessing({ audioTrackCount: 2, ktvTrack: null, isManagedDownload: false }, 'script'))
      .toEqual(expect.objectContaining({ vocalTrack: 0, forceScript: true, allowScript: true }))
  })

  it('replaces an existing instrumental when regeneration is forced', () => {
    expect(planForcedMediaProcessing({ audioTrackCount: 2, ktvTrack: 1, isManagedDownload: false }, 'instrumental'))
      .toEqual(expect.objectContaining({ vocalTrack: 0, generateInstrumental: true, replaceInstrumental: true }))
  })
})
