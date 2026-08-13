import Library from './Library.js'
import throttle from '@jcoreio/async-throttle'
import { SCANNER_WORKER_STATUS, LIBRARY_MATCH_SONG } from '../../shared/actionTypes.js'
import { ADMIN_SOCKETS } from '../lib/socketRooms.js'

/**
 * IPC action handlers
 */
export default function (io) {
  const emit = throttle(action => io.to(ADMIN_SOCKETS).emit('action', action), 1000)

  return {
    [LIBRARY_MATCH_SONG]: ({ payload }) => Library.matchSong(payload),
    [SCANNER_WORKER_STATUS]: action => emit(action),
  }
}
