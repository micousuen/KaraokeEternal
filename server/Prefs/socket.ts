import getLogger from '../lib/Log.js'
import Library from '../Library/Library.js'
import Prefs from './Prefs.js'
import { LIBRARY_PUSH, PREFS_PATH_SET_PRIORITY, PREFS_PUSH, PREFS_SET } from '../../shared/actionTypes.js'
import { emitAction, requireAdmin } from '../lib/socketActions.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'
const log = getLogger(`server[${process.pid}]`)

const ACTION_HANDLERS = {
  [PREFS_SET]: (sock, { payload }, acknowledge) => {
    if (!requireAdmin(sock, acknowledge, PREFS_SET)) return

    Prefs.set(payload.key, payload.data)
    log.info('%s (%s) set pref %s = %s', sock.user.name, sock.id, payload.key, payload.data)

    pushPrefs(sock)
  },
  [PREFS_PATH_SET_PRIORITY]: (sock, { payload }, acknowledge) => {
    if (!requireAdmin(sock, acknowledge, PREFS_PATH_SET_PRIORITY)) return

    Prefs.setPathPriority(payload)
    log.info('%s re-prioritized media folders; pushing library to all', sock.user.name)

    pushPrefs(sock)

    // invalidate cache
    Library.cache.version = null

    sock.server.emit('action', {
      type: LIBRARY_PUSH,
      payload: Library.get(),
    })
  },
} satisfies SocketHandlerMap

// helper to push prefs to admins
const pushPrefs = (sock) => {
  const admins: string[] = []

  for (const s of sock.server.sockets.sockets.values()) {
    if (s.user && s.user.isAdmin) {
      admins.push(s.id)
    }
  }

  if (admins.length) {
    emitAction(sock.server.to(admins), PREFS_PUSH, Prefs.get())
  }
}

export default ACTION_HANDLERS
