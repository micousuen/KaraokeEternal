import { parentPort, workerData } from 'node:worker_threads'
import { detectKtvTrack } from './KtvTrackDetector.js'

try {
  parentPort?.postMessage({ ok: true, result: await detectKtvTrack(workerData.source) })
} catch (err) {
  parentPort?.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  })
}
