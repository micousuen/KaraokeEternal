import {
  VOCAL_SEPARATION_MODELS_MOUNT,
  VOCAL_SEPARATION_MODELS_UNMOUNT,
  _SUCCESS,
} from '../../shared/actionTypes.js'
import {
  mountWhisperXModels,
  unmountWhisperXModels,
} from './VocalSeparation.js'

function requireAdmin (sock): void {
  if (!sock.user?.isAdmin) throw new Error('Administrator access is required')
}

const handlers = {
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
}

export default handlers
