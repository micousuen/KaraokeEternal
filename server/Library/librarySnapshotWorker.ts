import { parentPort, workerData } from 'node:worker_threads'
import { initLogger } from '../lib/Log.js'
import { buildLibrarySnapshot } from './LibrarySnapshot.js'

initLogger('library-cache', { console: { level: 0 }, file: { level: 0 } })
const { DatabaseWrapper } = await import('../lib/Database.js')
const database = new DatabaseWrapper(workerData.databaseFile, true)
try {
  parentPort!.postMessage({ ok: true, snapshot: buildLibrarySnapshot(database, workerData.version) })
} catch (error) {
  parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
} finally {
  database.close()
}
