import path from 'node:path'
import { parseFile } from 'music-metadata'
import MetaParser from '../MetaParser/MetaParser.js'
import type { MetadataResult, MetadataTask } from './MetadataWorkerPool.js'
import parseFilename from './parseFilename.js'

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

  const data = await parseFile(file, { duration: true, skipCovers: true })

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
