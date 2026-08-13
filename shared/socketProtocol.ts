import type { IRoomPrefs, PlaybackCoreStatus, PlaybackOptions } from './types.js'
/** Payloads accepted by the client-to-server Redux transport. */
export interface SocketRequestPayloads {
  'server/QUEUE_ADD': { songId: number }
  'server/QUEUE_MOVE': { queueId: number, prevQueueId: number }
  'server/QUEUE_REMOVE': { queueId: number | number[] }
  'server/QUEUE_SHUFFLE': { queueIds: number[] }
  'server/PLAYER_REQ_NEXT': undefined
  'server/PLAYER_REQ_OPTIONS': PlaybackOptions
  'server/PLAYER_REQ_PAUSE': undefined
  'server/PLAYER_REQ_PLAY': undefined
  'server/PLAYER_REQ_PRIORITY': { queueId: number }
  'server/PLAYER_REQ_REPLAY': { queueId: number }
  'server/PLAYER_REQ_SEEK': number
  'server/PLAYER_REQ_VOLUME': number
  'server/PLAYER_EMIT_CLAIM': undefined
  'server/PLAYER_EMIT_LEAVE': undefined
  'server/PLAYER_EMIT_STATUS': PlaybackCoreStatus & { visualizer: PlaybackOptions['visualizer'] }
  'server/PREFS_SET': { key: string, data: unknown }
  'server/PREFS_PATH_SET_PRIORITY': number[]
  'server/ROOM_PREFS_PUSH_REQUEST': { roomId: number, prefs: IRoomPrefs }
  'server/STAR_SONG': { songId: number }
  'server/UNSTAR_SONG': { songId: number }
  'server/vocalSeparation/MODELS_MOUNT': undefined
  'server/vocalSeparation/MODELS_UNMOUNT': undefined
  'server/vocalSeparation/PAUSE': undefined
  'server/vocalSeparation/RESUME': undefined
}

export type SocketRequestType = keyof SocketRequestPayloads

export interface SocketRequestMeta {
  isOptimistic?: boolean
  throttle?: {
    wait: number
    leading?: boolean
  }
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
