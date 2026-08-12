import { createAction, createReducer } from '@reduxjs/toolkit'
import { VOCAL_SEPARATION_STATUS } from 'shared/actionTypes'

export interface VocalSeparationState {
  enabled: boolean
  queuedSongs: number
  currentSong: string | null
  currentStartedAt: number | null
  currentProgress: number | null
  completedSongs: number
  averageSpeed: number | null
  lastError: string | null
}

const statusReceived = createAction<VocalSeparationState>(VOCAL_SEPARATION_STATUS)

const initialState: VocalSeparationState = {
  enabled: false,
  queuedSongs: 0,
  currentSong: null,
  currentStartedAt: null,
  currentProgress: null,
  completedSongs: 0,
  averageSpeed: null,
  lastError: null,
}

export default createReducer(initialState, (builder) => {
  builder.addCase(statusReceived, (_, { payload }) => payload)
})
