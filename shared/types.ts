export interface Artist {
  artistId: number
  name: string
  songIds: number[]
}

export interface Song {
  artistId: number
  duration: number
  language: string | null
  songId: number
  title: string
  numMedia: number
  isManagedDownload?: boolean
  hasSingleAudioTrack?: boolean
}

export interface YouTubeJob {
  jobId: string
  userId: number
  userDisplayName: string
  userDateUpdated: number
  roomId: number
  title: string
  status: 'queued' | 'downloading' | 'scanning' | 'complete' | 'error'
  progress: number | null
  message: string
  file?: string
}

export interface QueueItem {
  queueId: number
  songId: number
  userId: number
  prevQueueId: number | null
  mediaId: number
  rgTrackGain: number
  rgTrackPeak: number
  userDateUpdated: number
  userDisplayName: string
  isPlayed: boolean
  isOptimistic?: false
  isVideoKeyingEnabled: boolean
}

export interface OptimisticQueueItem {
  isOptimistic: true
  optimisticId?: number
  prevQueueId: number | null
  queueId: number
  songId: number
}

export interface QueueSnapshot {
  entities: Record<number, QueueItem>
  result: number[]
  revision: number
}

export interface QueuePatch {
  baseRevision: number
  changed: Record<number, QueueItem>
  removed: number[]
  result: number[]
  revision: number
}

export interface IRoomPrefs {
  qr: {
    isEnabled: boolean
    isServerManaged?: boolean
    opacity: number
    password: string
    size: number
  }
  user?: {
    isNewAllowed?: boolean
    isGuestAllowed?: boolean
  }
  roles?: Record<number, {
    allowNew: boolean
  }>
}

export interface Room {
  roomId: number
  name: string
  status: 'open' | 'closed'
  dateCreated: number
  hasPassword: boolean
  numUsers: number
  prefs?: IRoomPrefs
}

export interface Role {
  roleId: number
  name: string
}

export interface Path {
  pathId: number
  path: string
  priority: number
  prefs: {
    isVideoKeyingEnabled: boolean
    isWatchingEnabled: boolean
  }
}

export interface User {
  userId: number
  username: string
  name: string
  isAdmin: boolean // todo: client and server ctx only
  isGuest: boolean // todo: client and server ctx only
  dateCreated: number
  dateUpdated: number
}

export interface UserWithRole extends User {
  role?: string
}

export interface PlaybackOptions {
  audioTrack?: 0 | 1
  showScript?: boolean
  videoAlpha?: number
  visualizer?: {
    sensitivity?: number
    isEnabled?: boolean
    nextPreset?: boolean
    prevPreset?: boolean
    randomPreset?: boolean
  }
}

export interface PlaybackCoreStatus {
  audioTrack: 0 | 1
  audioTrackCount: number
  duration: number
  errorMessage: string
  history: number[]
  isAtQueueEnd: boolean
  isErrored: boolean
  isPlaying: boolean
  isVideoKeyingEnabled: boolean
  isWebGLSupported: boolean
  videoAlpha: number
  showScript: boolean
  nextUserId: number | null
  position: number
  queueId: number
  rgTrackGain: number | null
  rgTrackPeak: number | null
  volume: number
}

export interface PlaybackVisualizerStatus {
  isEnabled: boolean
  isSupported: boolean
  presetKey: string
  presetName: string
  sensitivity: number
}

export interface PlaybackStatus extends PlaybackCoreStatus {
  visualizer: PlaybackVisualizerStatus
}

export function createInitialPlaybackStatus (): PlaybackCoreStatus {
  return {
    audioTrack: 0,
    audioTrackCount: 0,
    duration: 0,
    errorMessage: '',
    history: [],
    isAtQueueEnd: false,
    isErrored: false,
    isPlaying: false,
    isVideoKeyingEnabled: false,
    isWebGLSupported: false,
    videoAlpha: 0.5,
    showScript: false,
    nextUserId: null,
    position: 0,
    queueId: -1,
    rgTrackGain: null,
    rgTrackPeak: null,
    volume: 1,
  }
}

export interface Media {
  songId: number
  mediaId: number
  isPreferred: boolean
  path: string
  relPath: string
  duration: number
}

export interface Prefs {
  isFirstRun?: boolean
  isScanning: boolean
  isReplayGainEnabled: boolean
  paths: {
    result: number[]
    entities: Record<number, Path>
  }
  roles: {
    result: number[]
    entities: Record<number, Role>
  }
  [key: string]: unknown
}
