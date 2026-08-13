import { parentPort, workerData } from 'node:worker_threads'
import { initLogger } from '../../lib/Log.js'
import type { MetadataTask } from './MetadataWorkerPool.js'

initLogger('scanner-metadata', {
  console: { level: 0 },
  file: { level: 0 },
})

const { extractMetadata } = await import('./extractMetadata.js')

parentPort?.on('message', async ({ id, input }: { id: number, input: MetadataTask }) => {
  try {
    parentPort?.postMessage({ id, ok: true, result: await extractMetadata(input, workerData.filenameFormat) })
  } catch (err) {
    parentPort?.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
