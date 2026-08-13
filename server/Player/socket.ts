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
  PLAYER_REQ_NEXT,
  PLAYER_REQ_OPTIONS,
  PLAYER_REQ_PAUSE,
  PLAYER_REQ_PLAY,
  PLAYER_REQ_PRIORITY,
  PLAYER_REQ_REPLAY,
  PLAYER_REQ_SEEK,
  PLAYER_REQ_VOLUME,
  PLAYER_EMIT_STATUS,
  PLAYER_EMIT_POSITION,
  PLAYER_EMIT_CLAIM,
  PLAYER_EMIT_LEAVE,
  PLAYER_STATUS,
  PLAYER_POSITION,
  PLAYER_LEAVE,
} from '../../shared/actionTypes.js'
import Queue from '../Queue/Queue.js'
import { emitToRoom, relayToRoom, requireAdmin } from '../lib/socketActions.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'
import type { PlaybackStatus } from '../../shared/types.js'
import { publishQueue } from '../Queue/QueuePublisher.js'
import { roomSockets } from '../lib/socketRooms.js'
import {
  claimPlayer,
  getPlayerStatus,
  releasePlayer,
  updatePlayerPosition,
  updatePlayerStatus,
} from './PlayerRegistry.js'

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [PLAYER_EMIT_CLAIM]: (sock) => {
    requireAdmin(sock)
    // Taking over is explicit and only happens when a player screen opens.
    // Routine playback/status updates must never transfer ownership.
    const previousId = claimPlayer(sock.user.roomId, sock.id)
    if (previousId) sock.server.sockets.sockets.get(previousId)?.emit('action', { type: PLAYER_CMD_TAKEOVER })
  },
  [PLAYER_REQ_OPTIONS]: relayToRoom(PLAYER_CMD_OPTIONS),
  [PLAYER_REQ_NEXT]: relayToRoom(PLAYER_CMD_NEXT),
  [PLAYER_REQ_PAUSE]: relayToRoom(PLAYER_CMD_PAUSE),
  [PLAYER_REQ_PLAY]: relayToRoom(PLAYER_CMD_PLAY),
  [PLAYER_REQ_PRIORITY]: (sock, { payload }) => {
    const { queueId } = payload
    if (!Queue.isInRoom(queueId, sock.user.roomId)) throw new Error('Queue item is not in this room')

    emitToRoom(sock, PLAYER_CMD_PRIORITY, { queueId })
  },
  [PLAYER_REQ_REPLAY]: (sock, { payload }) => {
    if (!Queue.isInRoom(payload.queueId, sock.user.roomId)) {
      throw new Error('Queue item is not in this room')
    }

    emitToRoom(sock, PLAYER_CMD_REPLAY, payload)
  },
  [PLAYER_REQ_SEEK]: relayToRoom(PLAYER_CMD_SEEK),
  [PLAYER_REQ_VOLUME]: relayToRoom(PLAYER_CMD_VOLUME),
  [PLAYER_EMIT_STATUS]: (sock, { payload }) => {
    requireAdmin(sock)
    const previous = getPlayerStatus(sock.user.roomId)
    const status = pickPlayerStatus(payload)
    if (!updatePlayerStatus(sock.user.roomId, sock.id, status)) return

    const history = status.history
    const previousHistory = new Set(previous?.history || [])
    const newlyPlayed = history.filter(queueId => !previousHistory.has(queueId))

    if (Queue.markPlayed(sock.user.roomId, newlyPlayed)) publishQueue(sock.server, sock.user.roomId)

    sock.to(roomSockets(sock.user.roomId)).emit('action', {
      type: PLAYER_STATUS,
      payload: status,
    })
  },
  [PLAYER_EMIT_POSITION]: (sock, { payload }) => {
    requireAdmin(sock)
    if (!updatePlayerPosition(sock.user.roomId, sock.id, payload.position)) return
    sock.to(roomSockets(sock.user.roomId)).volatile.emit('action', {
      type: PLAYER_POSITION,
      payload,
    })
  },
  [PLAYER_EMIT_LEAVE]: (sock) => {
    if (releasePlayer(sock.user.roomId, sock.id)) {
      sock.server.to(roomSockets(sock.user.roomId)).emit('action', {
        type: PLAYER_LEAVE,
        payload: { socketId: sock.id },
      })
    }
  },
} satisfies SocketHandlerMap

function pickPlayerStatus (status: PlaybackStatus): PlaybackStatus {
  return {
    audioTrack: status.audioTrack,
    audioTrackCount: status.audioTrackCount,
    duration: status.duration,
    errorMessage: status.errorMessage,
    history: status.history,
    isAtQueueEnd: status.isAtQueueEnd,
    isErrored: status.isErrored,
    isPlaying: status.isPlaying,
    isVideoKeyingEnabled: status.isVideoKeyingEnabled,
    isWebGLSupported: status.isWebGLSupported,
    videoAlpha: status.videoAlpha,
    showScript: status.showScript,
    nextUserId: status.nextUserId,
    position: status.position,
    queueId: status.queueId,
    rgTrackGain: status.rgTrackGain,
    rgTrackPeak: status.rgTrackPeak,
    volume: status.volume,
    visualizer: {
      isEnabled: status.visualizer.isEnabled,
      isSupported: status.visualizer.isSupported,
      presetKey: status.visualizer.presetKey,
      presetName: status.visualizer.presetName,
      sensitivity: status.visualizer.sensitivity,
    },
  }
}

export default ACTION_HANDLERS
