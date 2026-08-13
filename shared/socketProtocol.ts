import type { IRoomPrefs, PlaybackOptions, PlaybackStatus } from './types.js'
import {
  PLAYER_EMIT_CLAIM,
  PLAYER_EMIT_LEAVE,
  PLAYER_EMIT_STATUS,
  PLAYER_EMIT_POSITION,
  PLAYER_REQ_NEXT,
  PLAYER_REQ_OPTIONS,
  PLAYER_REQ_PAUSE,
  PLAYER_REQ_PLAY,
  PLAYER_REQ_PRIORITY,
  PLAYER_REQ_REPLAY,
  PLAYER_REQ_SEEK,
  PLAYER_REQ_VOLUME,
  PREFS_PATH_SET_PRIORITY,
  PREFS_SET,
  QUEUE_ADD,
  QUEUE_MOVE,
  QUEUE_REMOVE,
  QUEUE_SHUFFLE,
  QUEUE_SYNC,
  ROOM_PREFS_PUSH_REQUEST,
  STAR_SONG,
  UNSTAR_SONG,
  VOCAL_SEPARATION_MODELS_MOUNT,
  VOCAL_SEPARATION_MODELS_UNMOUNT,
  VOCAL_SEPARATION_PAUSE,
  VOCAL_SEPARATION_RESUME,
} from './actionTypes.js'
/** Payloads accepted by the client-to-server Redux transport. */
export interface SocketRequestPayloads {
  [QUEUE_ADD]: { songId: number }
  [QUEUE_MOVE]: { queueId: number, prevQueueId: number }
  [QUEUE_REMOVE]: { queueId: number | number[] }
  [QUEUE_SHUFFLE]: { queueIds: number[] }
  [QUEUE_SYNC]: undefined
  [PLAYER_REQ_NEXT]: undefined
  [PLAYER_REQ_OPTIONS]: PlaybackOptions
  [PLAYER_REQ_PAUSE]: undefined
  [PLAYER_REQ_PLAY]: undefined
  [PLAYER_REQ_PRIORITY]: { queueId: number }
  [PLAYER_REQ_REPLAY]: { queueId: number }
  [PLAYER_REQ_SEEK]: number
  [PLAYER_REQ_VOLUME]: number
  [PLAYER_EMIT_CLAIM]: PlaybackStatus
  [PLAYER_EMIT_LEAVE]: undefined
  [PLAYER_EMIT_STATUS]: PlaybackStatus
  [PLAYER_EMIT_POSITION]: { position: number }
  [PREFS_SET]: { key: string, data: unknown }
  [PREFS_PATH_SET_PRIORITY]: number[]
  [ROOM_PREFS_PUSH_REQUEST]: { roomId: number, prefs: IRoomPrefs }
  [STAR_SONG]: { songId: number }
  [UNSTAR_SONG]: { songId: number }
  [VOCAL_SEPARATION_MODELS_MOUNT]: undefined
  [VOCAL_SEPARATION_MODELS_UNMOUNT]: undefined
  [VOCAL_SEPARATION_PAUSE]: undefined
  [VOCAL_SEPARATION_RESUME]: undefined
}

export type SocketRequestType = keyof SocketRequestPayloads

export interface SocketRequestMeta {
  baseRevision?: number
  isOptimistic?: boolean
  requestId?: string
  throttle?: {
    wait: number
    leading?: boolean
  }
}

const EPHEMERAL_SOCKET_TYPES = new Set<string>([
  PLAYER_EMIT_POSITION,
  PLAYER_EMIT_STATUS,
  PLAYER_REQ_NEXT,
  PLAYER_REQ_OPTIONS,
  PLAYER_REQ_PAUSE,
  PLAYER_REQ_PLAY,
  PLAYER_REQ_PRIORITY,
  PLAYER_REQ_REPLAY,
  PLAYER_REQ_SEEK,
  PLAYER_REQ_VOLUME,
])

export function isEphemeralSocketRequest (type: string): boolean {
  return EPHEMERAL_SOCKET_TYPES.has(type)
}

export type SocketRequestAction<K extends SocketRequestType = SocketRequestType>
  = K extends SocketRequestType
    ? SocketRequestPayloads[K] extends undefined
      ? { type: K, payload?: undefined, meta?: SocketRequestMeta }
      : { type: K, payload: SocketRequestPayloads[K], meta?: SocketRequestMeta }
    : never

export interface SocketResponseAction {
  type: string
  payload?: unknown
  error?: string | boolean
  meta?: object
}

export type SocketAcknowledge = (action: SocketResponseAction) => void

export type SocketHandlerAction<K extends SocketRequestType>
  = Omit<SocketRequestAction<K>, 'type'> & { type?: K }

export type SocketHandler<K extends SocketRequestType = SocketRequestType> = (
  socket: any, // eslint-disable-line @typescript-eslint/no-explicit-any -- socket.io app fields are attached at runtime
  action: SocketHandlerAction<K>,
  acknowledge: SocketAcknowledge,
) => unknown

export type SocketHandlerMap = Partial<{
  [K in SocketRequestType]: SocketHandler<K>
}>

export function isSocketRequestAction (action: unknown): action is SocketRequestAction {
  return typeof action === 'object'
    && action !== null
    && 'type' in action
    && typeof action.type === 'string'
    && action.type.startsWith('server/')
}
