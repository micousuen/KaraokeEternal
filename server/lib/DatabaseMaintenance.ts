import { Worker } from 'node:worker_threads'
import { db } from './Database.js'
import getLogger from './Log.js'

const log = getLogger('DatabaseMaintenance')
let running = false
let requested = false
let timer: NodeJS.Timeout | undefined
const maintenanceDelayMs = nonNegativeInteger(process.env.KES_DATABASE_MAINTENANCE_DELAY_MS, 60_000)

/** Coalesce VACUUM requests and execute them outside the server event loop. */
export function scheduleDatabaseVacuum (): void {
  requested = true
  if (running || timer) return
  timer = setTimeout(() => {
    timer = undefined
    void drain()
  }, maintenanceDelayMs)
  timer.unref()
}

function nonNegativeInteger (value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

async function drain (): Promise<void> {
  running = true
  try {
    while (requested) {
      requested = false
      try {
        await runVacuumWorker(db.config.filename)
        log.info('Database vacuum completed')
      } catch (error) {
        log.warn('Database vacuum skipped: %s', error instanceof Error ? error.message : String(error))
      }
    }
  } finally {
    running = false
  }
}

function runVacuumWorker (databaseFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./databaseMaintenanceWorker.js', import.meta.url), {
      execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
      workerData: { databaseFile },
    })
    const timeoutMs = 2 * 60_000
    let settled = false
    const timeout = setTimeout(() => finish(new Error(`database vacuum timed out after ${timeoutMs}ms`)), timeoutMs)
    timeout.unref()
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate()
      if (error) reject(error)
      else resolve()
    }
    worker.once('message', message => message.ok ? finish() : finish(new Error(message.error)))
    worker.once('error', error => finish(error instanceof Error ? error : new Error(String(error))))
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`database vacuum worker exited without a result (code ${code})`))
    })
  })
}
