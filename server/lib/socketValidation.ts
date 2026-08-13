import {
  PLAYER_EMIT_CLAIM,
  PLAYER_EMIT_LEAVE,
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
} from '../../shared/actionTypes.js'

const NO_PAYLOAD = new Set([
  PLAYER_EMIT_LEAVE,
  PLAYER_REQ_NEXT,
  PLAYER_REQ_PAUSE,
  PLAYER_REQ_PLAY,
  QUEUE_SYNC,
  VOCAL_SEPARATION_MODELS_MOUNT,
  VOCAL_SEPARATION_MODELS_UNMOUNT,
  VOCAL_SEPARATION_PAUSE,
  VOCAL_SEPARATION_RESUME,
])

export function validateSocketAction (action: unknown): string | null {
  if (!isRecord(action) || typeof action.type !== 'string') return 'Socket action must be an object with a type'
  const payload = action.payload
  if (NO_PAYLOAD.has(action.type)) return payload === undefined ? null : 'This action does not accept a payload'

  switch (action.type) {
    case QUEUE_ADD:
    case STAR_SONG:
    case UNSTAR_SONG:
      return isIntegerField(payload, 'songId') ? null : 'songId must be an integer'
    case QUEUE_MOVE:
      return isIntegerField(payload, 'queueId') && isIntegerField(payload, 'prevQueueId') && hasBaseRevision(action)
        ? null
        : 'queueId, prevQueueId, and baseRevision must be integers'
    case QUEUE_REMOVE:
      return isQueueRemovePayload(payload) && hasBaseRevision(action)
        ? null
        : 'queueId must be an integer or a bounded integer array, with a valid baseRevision'
    case QUEUE_SHUFFLE:
      return isRecord(payload) && Array.isArray(payload.queueIds)
        && payload.queueIds.length <= 10_000 && payload.queueIds.every(Number.isInteger)
        && hasBaseRevision(action)
        ? null
        : 'queueIds must be a bounded integer array, with a valid baseRevision'
    case PLAYER_REQ_PRIORITY:
    case PLAYER_REQ_REPLAY:
      return isIntegerField(payload, 'queueId') ? null : 'queueId must be an integer'
    case PLAYER_REQ_SEEK:
    case PLAYER_REQ_VOLUME:
      return isFiniteNumber(payload) ? null : 'Player value must be finite'
    case PLAYER_EMIT_POSITION:
      return isRecord(payload) && isFiniteNumber(payload.position) && payload.position >= 0
        ? null
        : 'position must be a non-negative finite number'
    case PLAYER_REQ_OPTIONS:
      return isRecord(payload) ? null : 'Player options must be an object'
    case PLAYER_EMIT_CLAIM:
    case PLAYER_EMIT_STATUS:
      return validatePlayerStatus(payload)
    case PREFS_SET:
      return isRecord(payload) && typeof payload.key === 'string' && payload.key.length <= 100
        ? null
        : 'Preference key is invalid'
    case PREFS_PATH_SET_PRIORITY:
      return Array.isArray(payload) && payload.length <= 1000 && payload.every(Number.isInteger)
        ? null
        : 'Path priority must be an integer array'
    case ROOM_PREFS_PUSH_REQUEST:
      return isRecord(payload) && Number.isInteger(payload.roomId) && isRecord(payload.prefs)
        ? null
        : 'Room preferences payload is invalid'
    default:
      return null
  }
}

function hasBaseRevision (action: Record<string, unknown>): boolean {
  return isRecord(action.meta) && Number.isInteger(action.meta.baseRevision)
    && (action.meta.baseRevision as number) >= 0
}

function isQueueRemovePayload (payload: unknown): boolean {
  return isRecord(payload) && (Number.isInteger(payload.queueId)
    || (Array.isArray(payload.queueId) && payload.queueId.length <= 1000 && payload.queueId.every(Number.isInteger)))
}

export function consumeSocketRateLimit (socket, ephemeral: boolean): boolean {
  const now = Date.now()
  const windowMs = 10_000
  const limit = ephemeral ? 150 : 50
  const key = ephemeral ? 'ephemeralRate' : 'durableRate'
  const current = socket.data[key] as { startedAt: number, count: number } | undefined
  const bucket = !current || now - current.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : current
  bucket.count++
  socket.data[key] = bucket
  return bucket.count <= limit
}

function validatePlayerStatus (payload: unknown): string | null {
  if (!isRecord(payload)) return 'Player status must be an object'
  if (payload.audioTrack !== 0 && payload.audioTrack !== 1) return 'Player audioTrack is invalid'
  if (!isBoundedInteger(payload.audioTrackCount, 0, 100)) return 'Player audioTrackCount is invalid'
  if (!isNonNegativeNumber(payload.duration)) return 'Player duration is invalid'
  if (typeof payload.errorMessage !== 'string' || payload.errorMessage.length > 2000) return 'Player errorMessage is invalid'
  if (!Array.isArray(payload.history) || payload.history.length > 10_000 || !payload.history.every(Number.isInteger)) {
    return 'Player history is invalid'
  }
  for (const key of [
    'isAtQueueEnd',
    'isErrored',
    'isPlaying',
    'isVideoKeyingEnabled',
    'isWebGLSupported',
    'showScript',
  ]) {
    if (typeof payload[key] !== 'boolean') return `Player ${key} is invalid`
  }
  if (!Number.isInteger(payload.queueId)) return 'Player queueId must be an integer'
  if (payload.nextUserId !== null && !Number.isInteger(payload.nextUserId)) return 'Player nextUserId is invalid'
  if (!isNonNegativeNumber(payload.position)) return 'Player position is invalid'
  if (!isNullableFiniteNumber(payload.rgTrackGain) || !isNullableFiniteNumber(payload.rgTrackPeak)) {
    return 'Player replay gain is invalid'
  }
  if (!isBoundedNumber(payload.videoAlpha, 0, 1) || !isBoundedNumber(payload.volume, 0, 1)) {
    return 'Player level is invalid'
  }
  if (!isRecord(payload.visualizer)
    || typeof payload.visualizer.isEnabled !== 'boolean'
    || typeof payload.visualizer.isSupported !== 'boolean'
    || typeof payload.visualizer.presetKey !== 'string'
    || payload.visualizer.presetKey.length > 500
    || typeof payload.visualizer.presetName !== 'string'
    || payload.visualizer.presetName.length > 500
    || !isBoundedNumber(payload.visualizer.sensitivity, 0, 100)) {
    return 'Player visualizer is invalid'
  }
  return null
}

function isIntegerField (value: unknown, key: string): boolean {
  return isRecord(value) && Number.isInteger(value[key])
}

function isFiniteNumber (value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber (value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isBoundedNumber (value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max
}

function isBoundedInteger (value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

function isNullableFiniteNumber (value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
