import { createAction, createReducer } from '@reduxjs/toolkit'
import {
  VOCAL_SEPARATION_PAUSE,
  VOCAL_SEPARATION_RESUME,
  VOCAL_SEPARATION_STATUS,
} from 'shared/actionTypes'

export interface VocalSeparationState {
  enabled: boolean
  isPaused: boolean
  queuedSongs: number
  currentSong: string | null
  currentStartedAt: number | null
  currentProgress: number | null
  currentStage: 'separating' | 'scripting' | null
  currentTasks: ProcessingTask[]
  averageSpeed: number | null
  lastError: string | null
  completedThisRun: Array<{
    mediaId: number
    song: string
    status: 'processing' | 'succeeded' | 'failed'
    attempts: number
    startedAt: number | null
    completedAt: number | null
    audioSeconds: number | null
    processingSeconds: number | null
    error: string | null
    vadSeconds: number | null
    transcribeSeconds: number | null
    alignSeconds: number | null
  }>
  queued: Array<{ mediaId: number, song: string, tasks: ProcessingTask[] }>
}

interface ProcessingTask {
  type: 'separation' | 'instrumental' | 'scripting'
  label: string
  status: 'queued' | 'processing' | 'completed'
  progress: number | null
}

const statusReceived = createAction<VocalSeparationState>(VOCAL_SEPARATION_STATUS)
export const pauseVocalSeparation = createAction(VOCAL_SEPARATION_PAUSE)
export const resumeVocalSeparation = createAction(VOCAL_SEPARATION_RESUME)

const initialState: VocalSeparationState = {
  enabled: false,
  isPaused: false,
  queuedSongs: 0,
  currentSong: null,
  currentStartedAt: null,
  currentProgress: null,
  currentStage: null,
  currentTasks: [],
  averageSpeed: null,
  lastError: null,
  queued: [],
  completedThisRun: [],
}

export default createReducer(initialState, (builder) => {
  builder.addCase(statusReceived, (_, { payload }) => payload)
})
