import { createAction, createReducer } from '@reduxjs/toolkit'
import { AppThunk } from 'store/store'
import { CANCEL } from 'redux-throttle'
import getWebGLSupport from 'lib/getWebGLSupport'
import {
  PLAYER_CMD_NEXT,
  PLAYER_CMD_OPTIONS,
  PLAYER_CMD_PAUSE,
  PLAYER_CMD_PLAY,
  PLAYER_CMD_PRIORITY,
  PLAYER_CMD_REPLAY,
  PLAYER_CMD_SEEK,
  PLAYER_CMD_VOLUME,
  PLAYER_CMD_TAKEOVER,
  PLAYER_EMIT_LEAVE,
  PLAYER_EMIT_CLAIM,
  PLAYER_EMIT_STATUS,
  PLAYER_ERROR,
  PLAYER_LOAD,
  PLAYER_PLAY,
  PLAYER_UPDATE,
  REDUX_SLICE_INJECT_NOOP,
} from 'shared/actionTypes'
import { createInitialPlaybackStatus, type PlaybackCoreStatus } from 'shared/types'

const PRIVATE_PLAYER_STATE_KEYS = new Set([
  '_isFetching',
  '_isPlayingNext',
  '_priorityQueueId',
  '_isReplayingQueueId',
  '_lastReplayTime',
  '_lastSeekTime',
  '_seekPosition',
  '_isSuperseded',
])

// internal use
export const playerUpdate = createAction<object>(PLAYER_UPDATE)

// triggered by media events
export const playerError = createAction<string>(PLAYER_ERROR)
export const playerLoad = createAction(PLAYER_LOAD)
export const playerPlay = createAction(PLAYER_PLAY)
export const playerCmdNext = createAction(PLAYER_CMD_NEXT)

// triggered by clients
const playerCmdPause = createAction(PLAYER_CMD_PAUSE)
const playerCmdPlay = createAction(PLAYER_CMD_PLAY)
const playerCmdPriority = createAction<{ queueId: number | null }>(PLAYER_CMD_PRIORITY)
const playerCmdReplay = createAction<{ queueId: number }>(PLAYER_CMD_REPLAY)
const playerCmdSeek = createAction<number>(PLAYER_CMD_SEEK)
const playerCmdVolume = createAction<number>(PLAYER_CMD_VOLUME)
const playerCmdOptions = createAction<{
  audioTrack?: 0 | 1
  duration: number
  videoAlpha: number
  showScript: boolean
}>(PLAYER_CMD_OPTIONS)
const playerCmdTakeover = createAction(PLAYER_CMD_TAKEOVER)

// ------------------------------------
// Actions for emitting to room
// ------------------------------------
export function playerStatus (status: Partial<PlayerState> = {}, deferEmit = false): AppThunk {
  return (dispatch, getState) => {
    const { player, playerVisualizer } = getState()

    // update "internal" state (player slice); status is partial
    dispatch(playerUpdate(status))

    // emit full updated status (excluding "private" properties)
    const updated = { ...player, ...status }
    const emitStatus = Object.fromEntries(
      Object.entries(updated).filter(([key]) => !PRIVATE_PLAYER_STATE_KEYS.has(key)),
    ) as unknown as PlaybackCoreStatus

    dispatch({
      type: PLAYER_EMIT_STATUS,
      payload: {
        ...emitStatus,
        visualizer: playerVisualizer,
      },
      meta: {
        throttle: {
          wait: 1000,
          leading: !deferEmit,
        },
      },
    })
  }
}

// cancel any throttled/queued status emits
export function playerStatusCancel () {
  return {
    type: CANCEL,
    payload: {
      type: PLAYER_EMIT_STATUS,
    },
  }
}

export function playerLeave (): AppThunk {
  return (dispatch) => {
    dispatch(playerStatusCancel())
    dispatch({
      type: PLAYER_EMIT_LEAVE,
    })
  }
}

export function playerClaim (): AppThunk {
  return (dispatch) => {
    // Clear a takeover from a previous visit before claiming this player
    // session again on the existing socket connection.
    dispatch(playerUpdate({ _isSuperseded: false }))
    dispatch({ type: PLAYER_EMIT_CLAIM })
  }
}

// ------------------------------------
// Reducer
// ------------------------------------
export interface PlayerState extends PlaybackCoreStatus {
  _isFetching: boolean
  _isPlayingNext: boolean
  _priorityQueueId: number | null
  _isReplayingQueueId: number | null
  _lastReplayTime: number
  _lastSeekTime: number
  _seekPosition: number
  _isSuperseded: boolean
}

const initialState: PlayerState = {
  ...createInitialPlaybackStatus(),
  isWebGLSupported: getWebGLSupport(),
  // "private" internal state that shouldn't be emitted
  _isFetching: false,
  _isPlayingNext: false,
  _priorityQueueId: null,
  _isReplayingQueueId: null,
  _lastReplayTime: 0,
  _lastSeekTime: 0,
  _seekPosition: 0,
  _isSuperseded: false,
}

const playerReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(playerCmdTakeover, (state) => {
      state.isPlaying = false
      state._isSuperseded = true
    })
    .addCase(playerCmdNext, (state) => {
      state._isPlayingNext = true
    })
    .addCase(playerCmdOptions, (state, { payload }) => ({
      ...state,
      audioTrack: payload.audioTrack === 0 || payload.audioTrack === 1 ? payload.audioTrack : state.audioTrack,
      videoAlpha: typeof payload.videoAlpha === 'number' ? payload.videoAlpha : state.videoAlpha,
      showScript: typeof payload.showScript === 'boolean' ? payload.showScript : state.showScript,
    }))
    .addCase(playerCmdPause, (state) => {
      state.isPlaying = false
    })
    .addCase(playerCmdPlay, (state) => {
      state.isPlaying = true
    })
    .addCase(playerCmdPriority, (state, { payload }) => {
      state._priorityQueueId = payload.queueId
    })
    .addCase(playerCmdReplay, (state, { payload }) => {
      state._isReplayingQueueId = payload.queueId
      state._lastReplayTime = Date.now()
    })
    .addCase(playerCmdSeek, (state, { payload }) => {
      state._seekPosition = payload
      state._lastSeekTime = Date.now()
    })
    .addCase(playerCmdVolume, (state, { payload }) => {
      state.volume = payload
    })
    .addCase(playerError, (state, { payload }) => ({
      ...state,
      errorMessage: payload,
      isErrored: true,
      isPlaying: false,
      _isFetching: false,
    }))
    .addCase(playerLoad, state => ({
      ...state,
      errorMessage: '',
      isErrored: false,
      _isFetching: true,
    }))
    .addCase(playerPlay, (state) => {
      state._isFetching = false
    })
    .addCase(playerUpdate, (state, { payload }) => ({
      ...state,
      ...payload,
    }))
})

export default playerReducer

declare module 'store/reducers' {
  export interface LazyLoadedSlices {
    player: typeof initialState
  }
}

export const sliceInjectNoOp = createAction(REDUX_SLICE_INJECT_NOOP)
