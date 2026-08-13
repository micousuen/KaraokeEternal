export interface MediaProcessingFacts {
  audioTrackCount: number
  isManagedDownload: boolean
  ktvTrack: 0 | 1 | null
}

export interface MediaProcessingPlan {
  allowScript: boolean
  forceScript?: boolean
  generateInstrumental: boolean
  replaceInstrumental?: boolean
  runSeparation: boolean
  shouldSchedule: boolean
  vocalTrack: 0 | 1 | null
}

export function classifiedVocalTrack (
  audioTrackCount: number,
  ktvTrack: 0 | 1 | null,
  fallbackToFirstTrack = false,
): 0 | 1 | null {
  if (audioTrackCount < 1) return null
  if (audioTrackCount === 1) return 0
  if (ktvTrack === null) return fallbackToFirstTrack ? 0 : null
  return ktvTrack === 0 ? 1 : 0
}

export function planAutomaticMediaProcessing (facts: MediaProcessingFacts): MediaProcessingPlan {
  const vocalTrack = classifiedVocalTrack(facts.audioTrackCount, facts.ktvTrack)
  const shouldSchedule = facts.audioTrackCount === 1 || facts.isManagedDownload

  return {
    vocalTrack,
    shouldSchedule: shouldSchedule && vocalTrack !== null,
    runSeparation: shouldSchedule && vocalTrack !== null,
    generateInstrumental: facts.audioTrackCount === 1,
    allowScript: shouldSchedule,
  }
}

export function planForcedMediaProcessing (
  facts: MediaProcessingFacts,
  output: 'instrumental' | 'script',
): MediaProcessingPlan {
  const vocalTrack = classifiedVocalTrack(facts.audioTrackCount, facts.ktvTrack, true)

  return {
    vocalTrack,
    shouldSchedule: vocalTrack !== null,
    runSeparation: vocalTrack !== null,
    generateInstrumental: output === 'instrumental',
    allowScript: output === 'script',
    forceScript: output === 'script',
    replaceInstrumental: output === 'instrumental' && facts.audioTrackCount > 1,
  }
}
