import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { detectKtvTrack, ktvDetectorDefaults } from '../server/Media/KtvTrackDetector.js'

const target = process.argv[2] || 'test_folder/media'
const windowSeconds = process.argv[3] ? Number(process.argv[3]) : ktvDetectorDefaults.windowSeconds
const stats = await fsPromises.stat(target)
const files = stats.isDirectory()
  ? (await fsPromises.readdir(target, { withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => path.join(target, entry.name))
      .sort()
  : [target]

for (const file of files) {
  const started = performance.now()

  try {
    const result = await detectKtvTrack(file, windowSeconds)
    const ktv = result.ktvTrack === null ? 'unknown' : `A${result.ktvTrack + 1}`
    const vocal = result.vocalTrack === null ? 'unknown' : `A${result.vocalTrack + 1}`
    const elapsed = ((performance.now() - started) / 1000).toFixed(1)
    console.log(JSON.stringify({
      file: path.basename(file),
      windowSeconds,
      ktv,
      vocal,
      confidence: Number(result.confidence.toFixed(2)),
      spectralDifference: Number(result.spectralDifference.toFixed(5)),
      complexityDifference: Number(result.complexityDifference.toFixed(5)),
      agreement: Number(result.agreement.toFixed(2)),
      windowsAnalyzed: result.windowsAnalyzed,
      elapsedSeconds: Number(elapsed),
    }))
  } catch (err) {
    console.error(JSON.stringify({ file: path.basename(file), error: err.message }))
  }
}
