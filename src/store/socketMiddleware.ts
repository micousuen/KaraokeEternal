import { Action, Middleware, UnknownAction } from '@reduxjs/toolkit'
import { Socket } from 'socket.io-client'
import {
  isEphemeralSocketRequest,
  isSocketRequestAction,
  type SocketResponseAction,
} from 'shared/socketProtocol'
import {
  LIBRARY_INVALIDATE,
  QUEUE_ADD,
  QUEUE_MOVE,
  QUEUE_PLAY_NEXT,
  QUEUE_PATCH,
  QUEUE_REMOVE,
  QUEUE_SHUFFLE,
  QUEUE_SYNC,
  VOCAL_SEPARATION_MODELS_MOUNT,
  VOCAL_SEPARATION_MODELS_UNMOUNT,
} from 'shared/actionTypes'
import { syncLibrary } from './librarySync'

// optimistic actions need a transaction id to match BEGIN to COMMIT/REVERT
let nextOptimisticId = 1

export interface OptimisticResponseMeta {
  optimisticAction: {
    payload?: unknown
    type: string
  }
  optimisticId: number
}

export default function createSocketMiddleware (socket: Socket, prefix: string): Middleware {
  return (store) => {
    const updateConnectionVersions = () => {
      const state = store.getState() as {
        library?: { version?: number }
        starCounts?: { version?: number }
      }
      socket.io.opts.query = {
        library: state.library?.version || 0,
        stars: state.starCounts?.version || 0,
      }
    }
    socket.io.on('reconnect_attempt', updateConnectionVersions)

    // attach handler for incoming actions (from server)
    socket.on('action', (action) => {
      store.dispatch(action)
      if (action?.type === LIBRARY_INVALIDATE) {
        const state = store.getState() as { library?: { version?: number } }
        if (state.library?.version !== action.payload?.version) void syncLibrary(store, action.payload?.version)
      }
      if (action?.type === QUEUE_PATCH) {
        const state = store.getState() as { queue?: { revision?: number } }
        if (state.queue?.revision !== action.payload?.revision) {
          socket.emit('action', { type: QUEUE_SYNC })
        }
      }
    })

    return next => (action: Action & { meta?: { isOptimistic?: boolean } }) => {
      // dispatch normally if it's not a socket.io request
      if (!isSocketRequestAction(action) || !action.type.startsWith(prefix)) {
        return next(action)
      }

      const hasMeta = 'meta' in action
      const isOptimistic = hasMeta && (action.meta?.isOptimistic ?? false)
      const optimisticId = isOptimistic ? nextOptimisticId++ : undefined
      const ephemeral = isEphemeralSocketRequest(action.type)

      if (ephemeral) {
        if (socket.connected) socket.volatile.emit('action', socketAction(action))
        return next(action)
      }

      const requestId = createRequestId()
      const state = store.getState() as { queue?: { revision?: number } }
      const baseRevision = CONFLICT_SENSITIVE_QUEUE_MUTATIONS.has(action.type)
        ? state.queue?.revision
        : undefined
      const request = socketAction(action, requestId, baseRevision)
      const handleResponse = (cbAction: SocketResponseAction | UnknownAction) => {
        // make sure callback response is an action
        if (typeof cbAction !== 'object' || typeof cbAction.type !== 'string') {
          return
        }

        next(isOptimistic
          ? {
              ...cbAction,
              meta: {
                ...('meta' in cbAction && typeof cbAction.meta === 'object' ? cbAction.meta : {}),
                optimisticAction: { type: action.type, ...('payload' in action ? { payload: action.payload } : {}) },
                optimisticId,
              },
            }
          : cbAction)
      }
      emitDurable(socket, request, handleResponse, () => {
        handleResponse({
          type: `${action.type}_ERROR`,
          error: 'The server did not acknowledge the request. State will be resynchronized.',
        })
        if (QUEUE_MUTATIONS.has(action.type)) socket.emit('action', { type: QUEUE_SYNC })
      }, durablePolicy(action.type))

      if (!isOptimistic) {
        return next(action)
      }

      return next({
        ...action,
        meta: {
          ...action.meta,
          optimisticId,
        },
      })
    }
  }
}

const QUEUE_MUTATIONS = new Set([QUEUE_ADD, QUEUE_MOVE, QUEUE_PLAY_NEXT, QUEUE_REMOVE, QUEUE_SHUFFLE])
const CONFLICT_SENSITIVE_QUEUE_MUTATIONS = new Set([QUEUE_MOVE, QUEUE_PLAY_NEXT, QUEUE_REMOVE, QUEUE_SHUFFLE])

function socketAction (
  action: Action & { payload?: unknown },
  requestId?: string,
  baseRevision?: number,
): { type: string, payload?: unknown, meta?: { requestId: string, baseRevision?: number } } {
  return {
    type: action.type,
    ...('payload' in action ? { payload: action.payload } : {}),
    ...(requestId ? { meta: { requestId, ...(baseRevision === undefined ? {} : { baseRevision }) } } : {}),
  }
}

function emitDurable (
  socket: Socket,
  action: ReturnType<typeof socketAction>,
  onResponse: (action: SocketResponseAction) => void,
  onTimeout: () => void,
  policy: { deadlineMs: number, acknowledgementMs: number, attempts: number },
): void {
  let attempts = 0
  let finished = false
  const deadline = globalThis.setTimeout(() => finishTimeout(), policy.deadlineMs)

  const send = () => {
    if (finished) return
    if (!socket.connected) {
      socket.once('connect', send)
      return
    }
    attempts++
    socket.timeout(policy.acknowledgementMs).emit('action', action, (error: Error | null, response: SocketResponseAction) => {
      if (finished) return
      if (error) {
        if (attempts < policy.attempts) send()
        else finishTimeout()
        return
      }
      finished = true
      globalThis.clearTimeout(deadline)
      onResponse(response)
    })
  }

  const finishTimeout = () => {
    if (finished) return
    finished = true
    socket.off('connect', send)
    globalThis.clearTimeout(deadline)
    onTimeout()
  }

  send()
}

function durablePolicy (type: string) {
  if (type === VOCAL_SEPARATION_MODELS_MOUNT || type === VOCAL_SEPARATION_MODELS_UNMOUNT) {
    return { deadlineMs: 10 * 60_000, acknowledgementMs: 5 * 60_000, attempts: 2 }
  }
  return { deadlineMs: 15_000, acknowledgementMs: 5_000, attempts: 2 }
}

function createRequestId (): string {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}
