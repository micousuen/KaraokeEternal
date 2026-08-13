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
  PLAYER_POSITION,
  PLAYER_LEAVE,
} from 'shared/actionTypes'
import { createInitialPlaybackStatus, type PlaybackCoreStatus, type PlaybackOptions } from 'shared/types'

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
const playerPosition = createAction<{ position: number }>(PLAYER_POSITION)
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
interface StatusState extends PlaybackCoreStatus {
  isPlayerPresent: boolean
  visualizer: PlayerVisualizerState | Record<string, never>
}

const initialState: StatusState = {
  ...createInitialPlaybackStatus(),
  isPlayerPresent: false,
  visualizer: {},
}

const statusReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(playerLeave, (state) => {
      state.isPlayerPresent = false
    })
    .addCase(playerStatus, (state, { payload }) => ({
      ...state,
      ...payload,
      history: sameHistory(state.history, 'history' in payload ? payload.history : undefined),
      isPlayerPresent: true,
    }))
    .addCase(playerPosition, (state, { payload }) => {
      state.position = payload.position
      state.isPlayerPresent = true
    })
})

function sameHistory (current: number[], incoming: unknown): number[] {
  if (!Array.isArray(incoming) || !incoming.every(value => typeof value === 'number')) return current
  if (current.length === incoming.length && current.every((value, index) => value === incoming[index])) return current
  return incoming
}

export default statusReducer
