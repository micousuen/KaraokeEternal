export interface Artist {
  artistId: number
  name: string
  songIds: number[]
}

export interface Song {
  artistId: number
  duration: number
  songId: number
  title: string
  numMedia: number
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
  mediaType: 'cdg' | 'mp4'
  isPlayed: boolean
  isOptimistic?: false
  isVideoKeyingEnabled: boolean
}

export interface OptimisticQueueItem {
  isOptimistic: true
  prevQueueId: number
  queueId: number
  songId: number
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
  cdgAlpha?: number
  cdgSize?: number
  mp4Alpha?: number
  visualizer?: {
    sensitivity?: number
    isEnabled?: boolean
    nextPreset?: boolean
    prevPreset?: boolean
    randomPreset?: boolean
  }
}

export type MediaType = 'cdg' | 'mp4' | ''

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
