import { createAction, createReducer } from '@reduxjs/toolkit'
import { LOGOUT, YOUTUBE_JOBS_PUSH } from 'shared/actionTypes'
import type { YouTubeJob } from 'shared/types'

export const youtubeJobsPush = createAction<YouTubeJob[]>(YOUTUBE_JOBS_PUSH)
const logout = createAction(LOGOUT)

interface YouTubeJobsState {
  result: string[]
  entities: Record<string, YouTubeJob>
}

const initialState: YouTubeJobsState = { result: [], entities: {} }

const youtubeJobsReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(youtubeJobsPush, (state, { payload }) => ({
      result: payload.map(job => job.jobId),
      entities: Object.fromEntries(payload.map(job => [job.jobId, job])),
    }))
    .addCase(logout, () => initialState)
})

export default youtubeJobsReducer
