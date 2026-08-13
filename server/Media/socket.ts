import {
  VOCAL_SEPARATION_MODELS_MOUNT,
  VOCAL_SEPARATION_MODELS_UNMOUNT,
  VOCAL_SEPARATION_PAUSE,
  VOCAL_SEPARATION_RESUME,
  _SUCCESS,
} from '../../shared/actionTypes.js'
import {
  mountWhisperXModels,
  pauseVocalSeparation,
  resumeVocalSeparation,
  unmountWhisperXModels,
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
  [VOCAL_SEPARATION_MODELS_MOUNT]: async (sock, _action, acknowledge) => {
    requireAdmin(sock)
    await mountWhisperXModels()
    acknowledge({ type: VOCAL_SEPARATION_MODELS_MOUNT + _SUCCESS })
  },
  [VOCAL_SEPARATION_MODELS_UNMOUNT]: async (sock, _action, acknowledge) => {
    requireAdmin(sock)
    await unmountWhisperXModels()
    acknowledge({ type: VOCAL_SEPARATION_MODELS_UNMOUNT + _SUCCESS })
  },
} satisfies SocketHandlerMap

export default handlers
