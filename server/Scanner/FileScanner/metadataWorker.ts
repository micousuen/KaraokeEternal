import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { parseBuffer, parseFile } from 'music-metadata'
import { unzip } from 'unzipit'
import { initLogger } from '../../lib/Log.js'
import type { MetadataResult, MetadataTask } from './MetadataWorkerPool.js'
import parseFilename from './parseFilename.js'

initLogger('scanner-metadata', {
  console: { level: 0 },
  file: { level: 0 },
})

const [{ default: MetaParser }, { default: getCdgName }, { getExt }, { default: fileTypes }] = await Promise.all([
  import('../MetaParser/MetaParser.js'),
  import('../../lib/getCdgName.js'),
  import('../../lib/util.js'),
  import('../../Media/fileTypes.js'),
])
const audioExts = Object.keys(fileTypes).filter(ext => fileTypes[ext].mimeType.startsWith('audio/'))

parentPort?.on('message', async ({ id, input }: { id: number, input: MetadataTask }) => {
  try {
    parentPort?.postMessage({ id, ok: true, result: await extractMetadata(input) })
  } catch (err) {
    parentPort?.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

async function extractMetadata ({ file, parserConfig }: MetadataTask): Promise<MetadataResult> {
  const fileInfo = path.parse(file)
  const filenameInput: Record<string, unknown> = {
    dir: fileInfo.dir,
    dirSep: path.sep,
    name: fileInfo.name,
  }
  let filenameFields

  // Filename parsing is the zero-I/O fast path. Most karaoke collections have
  // authoritative names but incomplete embedded tags, so don't open the media
  // merely to discover duration or ReplayGain data.
  try {
    filenameFields = parseFilename(fileInfo.name, workerData.filenameFormat)
    const parsed = MetaParser(parserConfig)({ ...filenameInput, ...filenameFields })
    return {
      duration: 0,
      parsed,
      rgTrackGain: null,
      rgTrackPeak: null,
    }
  } catch {
    // Custom metadata templates and unparseable filenames fall back to the
    // more expensive media read below.
  }

  let mimeType = fileTypes[getExt(file)].mimeType
  let data

  if (getExt(file) === '.zip') {
    const buffer = await fsPromises.readFile(file)
    const { entries } = await unzip(new Uint8Array(buffer))
    const audioName = Object.keys(entries).find(name => !name.includes('/') && audioExts.includes(getExt(name)))
    if (!audioName) throw new Error(`no valid audio file ${JSON.stringify(audioExts)} found in archive`)
    if (!Object.keys(entries).find(name => !name.includes('/') && getExt(name) === '.cdg')) {
      throw new Error('no .cdg sidecar found in archive')
    }

    mimeType = fileTypes[getExt(audioName)].mimeType
    data = await parseBuffer(Buffer.from(await entries[audioName].arrayBuffer()), mimeType, {
      duration: true,
      skipCovers: true,
    })
  } else {
    if (fileTypes[getExt(file)].requiresCDG && !getCdgName(file)) throw new Error('no .cdg sidecar found')
    data = await parseFile(file, { duration: true, skipCovers: true })
  }

  if (!data.format.duration) throw new Error('could not determine duration')

  const parserInput: Record<string, unknown> = {
    ...filenameInput,
    meta: data.common,
    ...filenameFields,
  }

  const parsed = MetaParser(parserConfig)(parserInput)

  return {
    duration: data.format.duration,
    parsed,
    rgTrackGain: data.common.replaygain_track_gain ? data.common.replaygain_track_gain.dB : null,
    rgTrackPeak: data.common.replaygain_track_peak ? data.common.replaygain_track_peak.ratio : null,
  }
}
