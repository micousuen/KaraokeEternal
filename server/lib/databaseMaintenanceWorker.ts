import { parentPort, workerData } from 'node:worker_threads'
import { initLogger } from './Log.js'

initLogger('database-maintenance', { console: { level: 0 }, file: { level: 0 } })
const { DatabaseWrapper } = await import('./Database.js')
const database = new DatabaseWrapper(workerData.databaseFile, false)
try {
  database.exec('PRAGMA busy_timeout = 30000;')
  database.exec('VACUUM')
  parentPort!.postMessage({ ok: true })
} catch (error) {
  parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
} finally {
  database.close()
}
