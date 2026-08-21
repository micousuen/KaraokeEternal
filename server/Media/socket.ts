import {
  VOCAL_SEPARATION_PAUSE,
  VOCAL_SEPARATION_RESUME,
  _SUCCESS,
} from '../../shared/actionTypes.js'
import {
  pauseVocalSeparation,
  resumeVocalSeparation,
} from './VocalSeparation.js'
import { requireAdmin } from '../lib/socketActions.js'
import type { SocketHandlerMap } from '../../shared/socketProtocol.js'

const handlers = {
  [VOCAL_SEPARATION_PAUSE]: (sock, _action, acknowledge) => {
    requireAdmin(sock)
    pauseVocalSeparation()
    acknowledge({ type: VOCAL_SEPARATION_PAUSE + _SUCCESS })
  },
  [VOCAL_SEPARATION_RESUME]: (sock, _action, acknowledge) => {
    requireAdmin(sock)
    resumeVocalSeparation()
    acknowledge({ type: VOCAL_SEPARATION_RESUME + _SUCCESS })
  },
} satisfies SocketHandlerMap

export default handlers
