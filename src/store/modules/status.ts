import { createAction, createReducer } from '@reduxjs/toolkit'
import { type PlayerVisualizerState } from 'routes/Player/modules/playerVisualizer'
import {
  PLAYER_REQ_NEXT,
  PLAYER_REQ_OPTIONS,
  PLAYER_REQ_PLAY,
  PLAYER_REQ_PAUSE,
  PLAYER_REQ_PRIORITY,
  PLAYER_REQ_REPLAY,
  PLAYER_REQ_SEEK,
  PLAYER_REQ_VOLUME,
  PLAYER_STATUS,
  PLAYER_LEAVE,
} from 'shared/actionTypes'
import { MediaType, PlaybackOptions } from 'shared/types'

// ------------------------------------
// Actions
// ------------------------------------
export const requestPlay = createAction(PLAYER_REQ_PLAY)
export const requestPause = createAction(PLAYER_REQ_PAUSE)
export const requestPlayNext = createAction(PLAYER_REQ_NEXT)
export const requestPriority = createAction(PLAYER_REQ_PRIORITY, (queueId: number) => ({
  payload: { queueId },
}))
const playerStatus = createAction<object>(PLAYER_STATUS)
const playerLeave = createAction(PLAYER_LEAVE)

export const requestReplay = createAction(PLAYER_REQ_REPLAY, (queueId: number) => ({
  payload: { queueId },
}))

export const requestVolume = createAction(PLAYER_REQ_VOLUME, (vol: number) => ({
  payload: vol,
  meta: {
    throttle: {
      wait: 200,
      leading: false,
    },
  },
}))

export const requestSeek = createAction(PLAYER_REQ_SEEK, (position: number) => ({
  payload: position,
  meta: {
    throttle: {
      wait: 100,
      leading: false,
    },
  },
}))

export const requestOptions = createAction(PLAYER_REQ_OPTIONS, (opts: PlaybackOptions) => ({
  payload: opts,
  meta: {
    throttle: {
      wait: 200,
      leading: true,
    },
  },
}))

// ------------------------------------
// Reducer
// ------------------------------------
interface StatusState {
  audioTrack: 0 | 1
  audioTrackCount: number
  cdgAlpha: number
  cdgSize: number
  duration: number
  errorMessage: string
  historyJSON: string // queueIds in JSON array
  isAtQueueEnd: boolean
  isErrored: boolean
  isPlayerPresent: boolean
  isPlaying: boolean
  isVideoKeyingEnabled: boolean
  isWebGLSupported: boolean
  mediaType: MediaType | null
  mp4Alpha: number
  showScript: boolean
  nextUserId: number | null
  position: number
  queueId: number
  visualizer: PlayerVisualizerState | Record<string, never>
  volume: number
}

const initialState: StatusState = {
  audioTrack: 0,
  audioTrackCount: 0,
  cdgAlpha: 0,
  cdgSize: 0.8,
  duration: 0,
  errorMessage: '',
  historyJSON: '[]', // queueIds in JSON array
  isAtQueueEnd: false,
  isErrored: false,
  isPlayerPresent: false,
  isPlaying: false,
  isVideoKeyingEnabled: false,
  isWebGLSupported: false,
  mediaType: null,
  mp4Alpha: 1,
  showScript: false,
  nextUserId: null,
  position: 0,
  queueId: -1,
  visualizer: {},
  volume: 1,
}

const statusReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(playerLeave, (state) => {
      state.isPlayerPresent = false
    })
    .addCase(playerStatus, (state, { payload }) => ({
      ...state,
      ...payload,
      isPlayerPresent: true,
    }))
})

export default statusReducer
