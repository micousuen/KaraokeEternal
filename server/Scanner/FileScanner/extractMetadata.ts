import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { parseBuffer, parseFile } from 'music-metadata'
import { unzip } from 'unzipit'
import getCdgName from '../../lib/getCdgName.js'
import { getExt } from '../../lib/util.js'
import fileTypes from '../../Media/fileTypes.js'
import MetaParser from '../MetaParser/MetaParser.js'
import type { MetadataResult, MetadataTask } from './MetadataWorkerPool.js'
import parseFilename from './parseFilename.js'

const audioExts = Object.keys(fileTypes).filter(ext => fileTypes[ext].mimeType.startsWith('audio/'))

export async function extractMetadata (
  { file, parserConfig, forceMediaRead = false, technicalOnly = false }: MetadataTask,
  filenameFormat: string,
): Promise<MetadataResult> {
  const fileInfo = path.parse(file)
  const filenameInput: Record<string, unknown> = {
    dir: fileInfo.dir,
    dirSep: path.sep,
    name: fileInfo.name,
  }
  let filenameFields

  if (!forceMediaRead) {
    try {
      filenameFields = parseFilename(fileInfo.name, filenameFormat)
      const parsed = MetaParser(parserConfig)({ ...filenameInput, ...filenameFields })
      return {
        duration: 0,
        parsed,
        rgTrackGain: null,
        rgTrackPeak: null,
      }
    } catch {
      // Files whose names cannot identify the song must read their embedded
      // metadata before they can be added to the fast library result.
    }
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

  // Background analysis already has a database identity from the fast pass.
  // Do not make technical metadata depend on tags being sufficient to derive
  // an artist/title; malformed or sparse tags must not block duration updates.
  const parsed = technicalOnly
    ? { artist: '', artistNorm: '', title: '', titleNorm: '' }
    : MetaParser(parserConfig)({
        ...filenameInput,
        meta: data.common,
        ...filenameFields,
      })

  return {
    duration: data.format.duration,
    parsed,
    rgTrackGain: data.common.replaygain_track_gain ? data.common.replaygain_track_gain.dB : null,
    rgTrackPeak: data.common.replaygain_track_peak ? data.common.replaygain_track_peak.ratio : null,
  }
}
