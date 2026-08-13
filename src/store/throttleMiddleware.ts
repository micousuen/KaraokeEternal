import type { Middleware, UnknownAction } from '@reduxjs/toolkit'

export const THROTTLE_CANCEL = 'app/THROTTLE_CANCEL'

interface ThrottleAction extends UnknownAction {
  meta?: {
    throttle?: {
      leading?: boolean
      wait: number
    }
  }
}

interface PendingAction {
  action?: ThrottleAction
  timer: ReturnType<typeof setTimeout>
}

export default function createThrottleMiddleware (defaultWait: number): Middleware {
  const pending = new Map<string, PendingAction>()

  return () => next => (action: ThrottleAction) => {
    if (action.type === THROTTLE_CANCEL) {
      const type = (action.payload as { type?: unknown } | undefined)?.type
      if (typeof type === 'string') clearPending(type)
      return action
    }

    const options = action.meta?.throttle
    if (!options) return next(action)

    const wait = Number.isFinite(options.wait) ? Math.max(0, options.wait) : defaultWait
    const current = pending.get(action.type)
    if (current) {
      current.action = action
      return action
    }

    if (options.leading !== false) next(action)
    const entry: PendingAction = {
      action: options.leading === false ? action : undefined,
      timer: setTimeout(flush, wait),
    }
    pending.set(action.type, entry)
    return action

    function flush (): void {
      const trailing = entry.action
      entry.action = undefined
      if (!trailing) {
        pending.delete(action.type)
        return
      }
      next(trailing)
      // Preserve a full throttle window after the trailing dispatch too.
      entry.timer = setTimeout(flush, wait)
    }
  }

  function clearPending (type: string): void {
    const entry = pending.get(type)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(type)
  }
}
