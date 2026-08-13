import Library from './Library.js'
import { STAR_SONG, UNSTAR_SONG, STAR_COUNT_CHANGED, USER_STAR_CHANGED, _SUCCESS } from '../../shared/actionTypes.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'
import { userSockets } from '../lib/socketRooms.js'

const ACTION_HANDLERS = {
  [STAR_SONG]: (sock, { payload }, acknowledge) => {
    const changes = Library.starSong(payload.songId, sock.user.userId)

    // success
    acknowledge({ type: STAR_SONG + _SUCCESS })

    // tell all clients (some users may be in multiple rooms)
    if (changes) {
      const version = Library.getStarCounts().version
      sock.server.emit('action', {
        type: STAR_COUNT_CHANGED,
        payload: { songId: payload.songId, delta: 1, version },
      })
      sock.server.to(userSockets(sock.user.userId)).emit('action', {
        type: USER_STAR_CHANGED,
        payload: { songId: payload.songId, starred: true },
      })
    }
  },
  [UNSTAR_SONG]: (sock, { payload }, acknowledge) => {
    const changes = Library.unstarSong(payload.songId, sock.user.userId)

    // success
    acknowledge({ type: UNSTAR_SONG + _SUCCESS })

    if (changes) {
      const version = Library.getStarCounts().version
      // tell all clients (some users may be in multiple rooms)
      sock.server.emit('action', {
        type: STAR_COUNT_CHANGED,
        payload: { songId: payload.songId, delta: -1, version },
      })
      sock.server.to(userSockets(sock.user.userId)).emit('action', {
        type: USER_STAR_CHANGED,
        payload: { songId: payload.songId, starred: false },
      })
    }
  },
} satisfies SocketHandlerMap

export default ACTION_HANDLERS
