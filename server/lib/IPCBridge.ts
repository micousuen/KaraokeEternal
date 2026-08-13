import getLogger from './Log.js'
import { _ERROR, _SUCCESS } from '../../shared/actionTypes.js'
import type { ChildProcess } from 'child_process'

const log = getLogger('IPCBridge')
const PROCESS_NAME = process.env.KES_CHILD_PROCESS || 'main'
const isParent = typeof process.env.KES_CHILD_PROCESS === 'undefined' // @todo
const REQUEST_TIMEOUT_MS = 30_000

interface IPCMeta {
  pid?: number
  reqId?: number
  [key: string]: unknown
}

export interface IPCAction {
  error?: unknown
  meta?: IPCMeta
  payload?: unknown
  type: string
}

type IPCHandler = (action: IPCAction) => unknown | Promise<unknown>
type PendingRequest = {
  reject: (error: Error) => void
  resolve: (payload: unknown) => void
  timeout: NodeJS.Timeout
}

function serializeError (error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }

  return { message: String(error) }
}

function deserializeError (error: unknown) {
  if (error instanceof Error) return error

  if (error && typeof error === 'object' && 'message' in error) {
    const serialized = error as { message: unknown, name?: unknown, stack?: unknown }
    const result = new Error(String(serialized.message))
    if (typeof serialized.name === 'string') result.name = serialized.name
    if (typeof serialized.stack === 'string') result.stack = serialized.stack
    return result
  }

  return new Error(String(error))
}

async function handleAction (
  handlers: Record<string, IPCHandler>,
  action: IPCAction,
  reply: (action: IPCAction, pid?: number) => boolean,
) {
  const { meta, type } = action
  const handler = handlers[type]

  if (typeof handler !== 'function') {
    log.verbose(`${PROCESS_NAME}: no handler for action: ${type}`)
    return
  }

  try {
    const payload = await handler(action)
    if (!meta?.reqId) return

    reply({
      ...action,
      error: undefined,
      type: type + _SUCCESS,
      payload,
    }, meta.pid)
  } catch (error) {
    if (meta?.reqId) {
      reply({
        ...action,
        type: type + _ERROR,
        error: serializeError(error),
      }, meta.pid)
    }

    const message = error instanceof Error ? error.message : String(error)
    log.error(`${PROCESS_NAME}: error in ipc action ${type}: ${message}`)
  }
}

export class IPCParent {
  static children = new Map<number, ChildProcess>()
  static handlers: Record<string, IPCHandler> = {}

  static send (action: IPCAction, pid?: number) {
    // log.debug(`${PROCESS_NAME} emit: `, action.type)

    if (!this.children.size) {
      log.warn(`${PROCESS_NAME}: cannot send ${action.type}; no child processes are available`)
      return false
    }

    if (!pid) {
      let sent = false
      this.children.forEach((subprocess) => {
        sent = this.sendToChild(subprocess, action) || sent
      })
      return sent
    }

    const subprocess = this.children.get(pid)
    if (!subprocess) {
      log.warn(`${PROCESS_NAME}: cannot send ${action.type}; child ${pid} is unavailable`)
      return false
    }

    return this.sendToChild(subprocess, action)
  }

  private static sendToChild (subprocess: ChildProcess, action: IPCAction) {
    if (!subprocess.connected) return false

    try {
      subprocess.send(action, (error) => {
        if (error) log.warn(`${PROCESS_NAME}: failed to send ${action.type} to child ${subprocess.pid}: ${error.message}`)
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`${PROCESS_NAME}: failed to send ${action.type} to child ${subprocess.pid}: ${message}`)
      return false
    }
  }

  // 'this' keyword won't work when this method is passed as the
  // message handler callback, so using the class name (IPCParent)
  static handle (action: IPCAction) {
    void handleAction(IPCParent.handlers, action, (response, pid) => IPCParent.send(response, pid))
  }

  static addChild (subprocess: ChildProcess) {
    // parent: handle messages from child process
    subprocess.on('message', action => this.handle(action as IPCAction))
    if (subprocess.pid !== undefined) this.children.set(subprocess.pid, subprocess)
  }

  static removeChild (subprocess?: ChildProcess) {
    if (subprocess?.pid !== undefined) this.children.delete(subprocess.pid)
  }

  static use (obj: object) {
    this.handlers = {
      ...this.handlers,
      ...obj as Record<string, IPCHandler>,
    }
  }
}

export class IPCChild {
  static handlers: Record<string, IPCHandler> = {}
  static requests = new Map<number, PendingRequest>()
  static reqId = 0

  static send (action: IPCAction, onError?: (error: Error) => void) {
    // console.log(`${PROCESS_NAME} emit: `, action.type)
    if (typeof process.send !== 'function' || !process.connected) return false

    try {
      process.send(action, (error) => {
        if (error) onError?.(error)
      })
      return true
    } catch (error) {
      onError?.(deserializeError(error))
      return false
    }
  }

  // 'this' keyword won't work when this method is passed as the
  // message handler callback, so using the class name (IPCChild)
  static handle (action: IPCAction) {
    const { error, meta } = action

    // is this a response to a pending request?
    const request = meta?.reqId === undefined ? undefined : IPCChild.requests.get(meta.reqId)
    if (meta?.pid === process.pid && request) {
      IPCChild.requests.delete(meta.reqId)
      clearTimeout(request.timeout)

      if (error) {
        request.reject(deserializeError(error))
      } else {
        request.resolve(action.payload)
      }

      // console.log(`${PROCESS_NAME} ack:`, type)
      return
    }

    void handleAction(IPCChild.handlers, action, response => IPCChild.send(response))
  }

  // used by child processes only
  static req (action: IPCAction, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (typeof process.send !== 'function' || !process.connected) {
      return Promise.reject(new Error(`${PROCESS_NAME}: parent process is unavailable`))
    }

    const reqId = ++this.reqId
    const requestAction = {
      ...action,
      meta: {
        ...action.meta,
        reqId,
        pid: process.pid,
      },
    }

    return new Promise<unknown>((resolve, reject) => {
      const finishWithError = (error: Error) => {
        const request = this.requests.get(reqId)
        if (!request) return

        this.requests.delete(reqId)
        clearTimeout(request.timeout)
        reject(error)
      }

      const timeout = setTimeout(() => {
        finishWithError(new Error(`${PROCESS_NAME}: IPC request ${action.type} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timeout.unref()
      this.requests.set(reqId, { resolve, reject, timeout })

      if (!this.send(requestAction, finishWithError)) {
        finishWithError(new Error(`${PROCESS_NAME}: parent process is unavailable`))
      }
    })
  }

  static use (obj: object) {
    this.handlers = {
      ...this.handlers,
      ...obj as Record<string, IPCHandler>,
    }
  }
}

export default isParent ? IPCParent : IPCChild

if (!isParent) {
  // child: handle messages from parent process
  // this also prevents child processes from automatically exiting
  process.on('message', IPCChild.handle)
}
