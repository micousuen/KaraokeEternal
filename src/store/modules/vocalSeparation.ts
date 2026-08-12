import { createAction, createReducer } from '@reduxjs/toolkit'
import { VOCAL_SEPARATION_STATUS } from 'shared/actionTypes'

export interface VocalSeparationState {
  enabled: boolean
  queuedSongs: number
  currentSong: string | null
  currentStartedAt: number | null
  currentProgress: number | null
  currentStage: 'separating' | 'scripting' | null
  currentTasks: ProcessingTask[]
  completedSongs: number
  averageSpeed: number | null
  lastError: string | null
  recent: Array<{
    mediaId: number
    song: string
    status: 'processing' | 'succeeded' | 'failed'
    attempts: number
    startedAt: number | null
    completedAt: number | null
    audioSeconds: number | null
    processingSeconds: number | null
    error: string | null
  }>
  queued: Array<{ mediaId: number, song: string, tasks: ProcessingTask[] }>
  completedThisRun: VocalSeparationState['recent']
}

interface ProcessingTask {
  type: 'separation' | 'instrumental' | 'scripting'
  label: string
  status: 'queued' | 'processing' | 'completed'
  progress: number | null
}

const statusReceived = createAction<VocalSeparationState>(VOCAL_SEPARATION_STATUS)

const initialState: VocalSeparationState = {
  enabled: false,
  queuedSongs: 0,
  currentSong: null,
  currentStartedAt: null,
  currentProgress: null,
  currentStage: null,
  currentTasks: [],
  completedSongs: 0,
  averageSpeed: null,
  lastError: null,
  recent: [],
  queued: [],
  completedThisRun: [],
}

export default createReducer(initialState, (builder) => {
  builder.addCase(statusReceived, (_, { payload }) => payload)
})
