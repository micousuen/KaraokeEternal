import getLogger from '../lib/Log.js'
import Prefs from './Prefs.js'
import { PREFS_PATH_SET_PRIORITY, PREFS_PUSH, PREFS_SET } from '../../shared/actionTypes.js'
import { emitAction, requireAdmin } from '../lib/socketActions.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'
import { ADMIN_SOCKETS } from '../lib/socketRooms.js'
import { invalidateLibrary } from '../Library/LibraryPublisher.js'
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

    invalidateLibrary(sock.server)
  },
} satisfies SocketHandlerMap

// helper to push prefs to admins
const pushPrefs = (sock) => {
  emitAction(sock.server.to(ADMIN_SOCKETS), PREFS_PUSH, Prefs.get())
}

export default ACTION_HANDLERS
