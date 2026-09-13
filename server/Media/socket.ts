import {
  VOCAL_SEPARATION_STOP,
  VOCAL_SEPARATION_RESUME,
  VOCAL_SEPARATION_RETRY,
  _ERROR,
  _SUCCESS,
} from '../../shared/actionTypes.js'
import {
  stopVocalSeparation,
  resumeVocalSeparation,
  retryVocalSeparation,
} from './VocalSeparation.js'
import { requireAdmin } from '../lib/socketActions.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'

const handlers = {
  [VOCAL_SEPARATION_STOP]: (sock, _action, acknowledge) => {
    requireAdmin(sock)
    stopVocalSeparation()
    acknowledge({ type: VOCAL_SEPARATION_STOP + _SUCCESS })
  },
  [VOCAL_SEPARATION_RESUME]: (sock, _action, acknowledge) => {
    requireAdmin(sock)
    resumeVocalSeparation()
    acknowledge({ type: VOCAL_SEPARATION_RESUME + _SUCCESS })
  },
  [VOCAL_SEPARATION_RETRY]: (sock, action, acknowledge) => {
    requireAdmin(sock)
    if (!retryVocalSeparation(action.payload.mediaId)) {
      acknowledge({ type: VOCAL_SEPARATION_RETRY + _ERROR, error: 'That song is already queued or processing' })
      return
    }
    acknowledge({ type: VOCAL_SEPARATION_RETRY + _SUCCESS })
  },
} satisfies SocketHandlerMap

export default handlers
