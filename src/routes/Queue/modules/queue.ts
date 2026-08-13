import { createAction, createReducer, type UnknownAction } from '@reduxjs/toolkit'
import { RootState, AppDispatch, AppThunk } from 'store/store'
import getUpcoming from '../selectors/getUpcoming'
import {
  QUEUE_ADD,
  QUEUE_MOVE,
  QUEUE_PLAY_NEXT,
  QUEUE_SHUFFLE,
  QUEUE_PUSH,
  QUEUE_PATCH,
  QUEUE_REMOVE,
  LOGOUT,
} from 'shared/actionTypes'
import type { QueueItem, OptimisticQueueItem, QueuePatch, QueueSnapshot } from 'shared/types'

// ------------------------------------
// Actions
// ------------------------------------
const logout = createAction(LOGOUT)
export const moveItem = createAction<{ queueId: number, prevQueueId: number }>(QUEUE_MOVE)
export const playNext = createAction<{ queueId: number, prevQueueId: number }>(QUEUE_PLAY_NEXT)
export const shuffleItems = createAction<{ queueIds: number[] }>(QUEUE_SHUFFLE)
export const removeItem = createAction<{ queueId: number | number[] }>(QUEUE_REMOVE)
export const queuePush = createAction<QueueSnapshot>(QUEUE_PUSH)
const queuePatch = createAction<QueuePatch>(QUEUE_PATCH)

export const queueSong = createAction(QUEUE_ADD, (songId: number) => ({
  payload: { songId },
  meta: { isOptimistic: true },
}))

export const removeUpcomingItems = (userId: number): AppThunk => (dispatch: AppDispatch, getState: () => RootState) => {
  const upcomingQueueIds = getUpcoming(getState(), userId)
  dispatch(removeItem({ queueId: upcomingQueueIds }))
}

// ------------------------------------
// Reducer
// ------------------------------------
interface QueueState {
  isLoading: boolean
  result: number[] // queueIds
  entities: Record<number, QueueItem | OptimisticQueueItem>
  revision: number
}

const initialState: QueueState = {
  isLoading: true,
  result: [],
  entities: {},
  revision: 0,
}
let nextOptimisticQueueId = -1

const queueReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(queueSong, (state, { payload, meta }) => {
      // optimistic
      const nextQueueId = nextOptimisticQueueId--
      const prevQueueId = state.result.length ? state.result[state.result.length - 1] : null

      state.result.push(nextQueueId)
      state.entities[nextQueueId] = {
        ...payload,
        queueId: nextQueueId,
        prevQueueId,
        isOptimistic: true,
        optimisticId: 'optimisticId' in meta && typeof meta.optimisticId === 'number' ? meta.optimisticId : undefined,
      }
    })
    .addCase(queuePush, (state, { payload }) => ({
      isLoading: false,
      result: payload.result,
      entities: payload.entities,
      revision: payload.revision || state.revision + 1,
    }))
    .addCase(queuePatch, (state, { payload }) => {
      if (payload.revision <= state.revision) return
      if (state.revision !== payload.baseRevision) {
        state.isLoading = true
        return
      }
      for (const queueId of state.result) {
        if (!payload.result.includes(queueId)) delete state.entities[queueId]
      }
      for (const queueId of payload.removed) delete state.entities[queueId]
      Object.assign(state.entities, payload.changed)
      state.result = payload.result
      state.revision = payload.revision
      state.isLoading = false
    })
    .addCase(logout, (state) => {
      state.result = []
      state.entities = {}
      state.revision = 0
      state.isLoading = true
    })
    .addMatcher(isQueueAddError, (state, action) => {
      const optimisticId = action.meta?.optimisticId
      if (typeof optimisticId !== 'number') return
      const queueId = state.result.find(id => state.entities[id].isOptimistic === true
        && state.entities[id].optimisticId === optimisticId)
      if (queueId === undefined) return
      state.result.splice(state.result.indexOf(queueId), 1)
      delete state.entities[queueId]
    })
    .addMatcher(isQueueConflict, (_state, action) => ({
      isLoading: false,
      result: action.payload.queue.result,
      entities: action.payload.queue.entities,
      revision: action.payload.queue.revision,
    }))
})

function isQueueAddError (action: UnknownAction): action is UnknownAction & {
  meta?: { optimisticId?: number }
} {
  return action.type === `${QUEUE_ADD}_ERROR`
}

function isQueueConflict (action: UnknownAction): action is UnknownAction & {
  payload: { code: 'QUEUE_CONFLICT', queue: QueueSnapshot }
} {
  if (!('payload' in action) || typeof action.payload !== 'object' || action.payload === null) return false
  const payload = action.payload as { code?: unknown, queue?: unknown }
  return payload.code === 'QUEUE_CONFLICT' && typeof payload.queue === 'object' && payload.queue !== null
}

export default queueReducer
