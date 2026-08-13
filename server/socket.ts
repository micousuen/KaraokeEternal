import getLogger from './lib/Log.js'
import jsonWebToken from 'jsonwebtoken'
import parseCookie from './lib/parseCookie.js'
import Library from './Library/Library.js'
import LibrarySocket from './Library/socket.js'
import PlayerSocket from './Player/socket.js'
import Prefs from './Prefs/Prefs.js'
import PrefsSocket from './Prefs/socket.js'
import Rooms from './Rooms/Rooms.js'
import RoomsSocket from './Rooms/socket.js'
import QueueSocket from './Queue/socket.js'
import MediaSocket from './Media/socket.js'
import { getRoomYouTubeJobs } from './YouTube/YouTube.js'
import { getVocalSeparationStatus } from './Media/VocalSeparation.js'
import { getPlayerStatus, releasePlayer } from './Player/PlayerRegistry.js'
import { sendQueueSnapshot } from './Queue/QueuePublisher.js'
import { joinIdentityRooms, roomSockets } from './lib/socketRooms.js'
import { consumeSocketRateLimit, validateSocketAction } from './lib/socketValidation.js'
import { isEphemeralSocketRequest, type SocketResponseAction } from '../shared/socketProtocol.js'
import { registerPresence, releasePresence } from './User/PresenceRegistry.js'
import { validateUserContext } from './User/UserContext.js'

import {
  LIBRARY_INVALIDATE,
  STARS_PUSH,
  STAR_COUNTS_PUSH,
  PLAYER_STATUS,
  PLAYER_LEAVE,
  PREFS_PUSH,
  YOUTUBE_JOBS_PUSH,
  SOCKET_AUTH_ERROR,
  VOCAL_SEPARATION_STATUS,
  _ERROR,
  _SUCCESS,
} from '../shared/actionTypes.js'
const log = getLogger('server')

const handlers = {
  ...LibrarySocket,
  ...QueueSocket,
  ...MediaSocket,
  ...PlayerSocket,
  ...PrefsSocket,
  ...RoomsSocket,
}

const { verify: jwtVerify } = jsonWebToken
const completedRequests = new Map<string, { expiresAt: number, response: SocketResponseAction }>()
const pendingRequests = new Map<string, Promise<SocketResponseAction>>()

export default function (io, jwtKey) {
  io.on('connection', async (sock) => {
    const { keToken } = parseCookie(sock.handshake.headers.cookie)
    const clientLibraryVersion = parseInt(sock.handshake.query.library, 10)
    const clientStarsVersion = parseInt(sock.handshake.query.stars, 10)

    // authenticate the JWT sent via cookie in http handshake
    try {
      sock.user = validateUserContext(jwtVerify(keToken, jwtKey))
      await joinIdentityRooms(sock)
      if (typeof sock.user.userId === 'number' && typeof sock.user.roomId === 'number') {
        registerPresence(sock.id, sock.user.userId, sock.user.roomId)
      }

      // success
      log.verbose('%s (%s) connected from %s', sock.user.name, sock.id, sock.handshake.address)
    } catch (err) {
      io.to(sock.id).emit('action', {
        type: SOCKET_AUTH_ERROR,
      })

      sock.user = null
      sock.disconnect()
      log.verbose('disconnected %s (%s)', sock.handshake.address, err.message)
      return
    }

    // attach disconnect handler
    sock.on('disconnect', (reason) => {
      releasePresence(sock.id)
      log.verbose('%s (%s) disconnected (%s)',
        sock.user.name, sock.id, reason,
      )

      if (typeof sock.user.roomId !== 'number') return

      // beyond this point assumes there is a room

      log.verbose('%s (%s) left room %s (%s; %s in room)',
        sock.user.name, sock.id, sock.user.roomId, reason, sock.adapter.rooms.size,
      )

      if (releasePlayer(sock.user.roomId, sock.id)) {
        io.to(roomSockets(sock.user.roomId)).emit('action', {
          type: PLAYER_LEAVE,
          payload: { socketId: sock.id },
        })
      }
    })

    // attach action handler
    sock.on('action', async (action, callback) => {
      const acknowledge = typeof callback === 'function' ? callback : () => undefined
      const validationError = validateSocketAction(action)
      const type = typeof action?.type === 'string' ? action.type : 'UNKNOWN_SOCKET_ACTION'

      if (!sock.user) {
        return acknowledge({
          type: SOCKET_AUTH_ERROR,
        })
      }

      if (validationError) {
        return acknowledge({ type: type + _ERROR, error: validationError })
      }

      if (typeof handlers[type] !== 'function') {
        log.error('No handler for socket action: %s', type)
        return acknowledge({ type: type + _ERROR, error: 'Unsupported socket action' })
      }

      const ephemeral = isEphemeralSocketRequest(type)
      const requestId = !ephemeral && typeof action.meta?.requestId === 'string'
        && /^[a-zA-Z0-9_-]{8,80}$/.test(action.meta.requestId)
        ? action.meta.requestId
        : undefined
      const requestKey = requestId ? `${sock.user.userId}:${requestId}` : undefined
      const completed = requestKey ? completedRequests.get(requestKey) : undefined
      if (completed && completed.expiresAt > Date.now()) return acknowledge(completed.response)
      const pending = requestKey ? pendingRequests.get(requestKey) : undefined
      if (pending) return acknowledge(await pending)

      if (!consumeSocketRateLimit(sock, ephemeral)) {
        return acknowledge({ type: type + _ERROR, error: 'Too many socket requests' })
      }

      let resolvePending: ((response: SocketResponseAction) => void) | undefined
      if (requestKey) {
        pendingRequests.set(requestKey, new Promise((resolve) => {
          resolvePending = resolve
        }))
      }

      let acknowledged = false
      const reply = (response: SocketResponseAction) => {
        if (acknowledged) return
        acknowledged = true
        if (requestKey) {
          rememberRequest(requestKey, response)
          pendingRequests.delete(requestKey)
          resolvePending?.(response)
        }
        acknowledge(response)
      }

      try {
        await handlers[type](sock, action, reply)
        reply({ type: type + _SUCCESS })
      } catch (err) {
        log.error(err)

        return reply({
          type: type + _ERROR,
          error: `Error in ${type}: ${err.message}`,
        })
      }
    })

    // push prefs (admin only)
    if (sock.user.isAdmin) {
      log.verbose('pushing prefs to %s (%s)', sock.user.name, sock.id)
      io.to(sock.id).emit('action', {
        type: PREFS_PUSH,
        payload: Prefs.get(),
      })
      io.to(sock.id).emit('action', {
        type: VOCAL_SEPARATION_STATUS,
        payload: getVocalSeparationStatus(),
      })
    }

    // Large library snapshots are fetched over cacheable/compressed HTTP.
    const libraryVersion = Library.getVersion()
    if (clientLibraryVersion !== libraryVersion) {
      log.verbose('pushing library to %s (%s) (client=%s, server=%s)',
        sock.user.name, sock.id, clientLibraryVersion, libraryVersion)

      io.to(sock.id).emit('action', {
        type: LIBRARY_INVALIDATE,
        payload: { version: libraryVersion },
      })
    }

    // push user's stars
    io.to(sock.id).emit('action', {
      type: STARS_PUSH,
      payload: Library.getUserStars(sock.user.userId),
    })

    // push star counts (only if client's is outdated)
    if (clientStarsVersion !== Library.starCountsCache.version) {
      log.verbose('pushing star counts to %s (%s) (client=%s, server=%s)',
        sock.user.name, sock.id, clientStarsVersion, Library.starCountsCache.version)

      io.to(sock.id).emit('action', {
        type: STAR_COUNTS_PUSH,
        payload: Library.getStarCounts(),
      })
    }

    // it's possible for an admin to not be in a room
    if (typeof sock.user.roomId !== 'number') return

    // beyond this point assumes there is a room

    // add user to room and track membership
    Rooms.trackUser(sock.user.roomId, sock.user.userId)

    // if there's a player in room, emit its last known status
    // @todo this just emits the first status found
    const playerStatus = getPlayerStatus(sock.user.roomId)
    if (playerStatus) {
      io.to(sock.id).emit('action', { type: PLAYER_STATUS, payload: playerStatus })
    }

    log.verbose('%s (%s) joined room %s (%s in room)',
      sock.user.name, sock.id, sock.user.roomId, sock.adapter.rooms.size,
    )

    // send room's queue
    sendQueueSnapshot(sock, sock.user.roomId)
    io.to(sock.id).emit('action', {
      type: YOUTUBE_JOBS_PUSH,
      payload: getRoomYouTubeJobs(sock.user.roomId),
    })
  })
}

function rememberRequest (key: string, response: SocketResponseAction): void {
  const now = Date.now()
  if (completedRequests.size >= 5000) {
    for (const [requestKey, request] of completedRequests) {
      if (request.expiresAt <= now || completedRequests.size >= 5000) completedRequests.delete(requestKey)
      if (completedRequests.size < 4500) break
    }
  }
  completedRequests.set(key, { response, expiresAt: now + 5 * 60_000 })
}
