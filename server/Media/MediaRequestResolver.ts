import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { unzip } from 'unzipit'
import getLogger from '../lib/Log.js'
import getCdgName from '../lib/getCdgName.js'
import { getExt } from '../lib/util.js'
import Media from './Media.js'
import Prefs from '../Prefs/Prefs.js'
import fileTypes from './fileTypes.js'
import { ensureAudioTrackAnalysis } from './AudioTrackAnalysis.js'
import { getBrowserAudio, getBrowserMedia, getSourceAudio, getSourceMediaInfo } from './Transcoder.js'

const log = getLogger('MediaRequestResolver')
const audioExts = Object.keys(fileTypes).filter(ext => fileTypes[ext].mimeType.startsWith('audio/'))

export type ResolvedMediaRequest = {
  body?: object
  buffer?: Buffer
  cacheControl?: string
  file?: string
  kind: 'file' | 'json'
  length?: number
  mimeType: string
}

export class MediaRequestError extends Error {
  status: number

  constructor (status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function resolveMediaRequest (
  mediaId: number,
  type: string,
  query: { audioFormat?: unknown, audioTrack?: unknown } = {},
): Promise<ResolvedMediaRequest> {
  const result = Media.search({ mediaId })
  if (!result.result.length) throw new MediaRequestError(404, 'mediaId not found')

  const { pathId, relPath } = result.entities[mediaId]
  const basePath = Prefs.get().paths.entities[pathId].path
  let file = path.join(basePath, relPath)

  if (type === 'script') return resolveScript(file)

  let buffer: Buffer | undefined
  let mimeType: string | undefined
  let length: number
  if (getExt(file) === '.zip') {
    const resolved = await resolveArchive(file, type)
    buffer = resolved.buffer
    length = resolved.buffer.length
    mimeType = resolved.mimeType
  } else {
    if (type === 'cdg') {
      const cdg = getCdgName(file)
      if (!cdg) throw new MediaRequestError(404, 'The .cdg file could not be found')
      file = cdg
    }
    const stats = await fsPromises.stat(file)
    length = stats.size
    mimeType = fileTypes[getExt(file)]?.mimeType
  }

  if (type === 'sourceVideo') {
    if (!mimeType?.startsWith('video/')) throw new MediaRequestError(422, 'Source is not a video')
    return fileResponse(file, mimeType, length, buffer, 'no-store')
  }

  if (type === 'videoInfo') {
    const [sourceInfo, analyzed] = await Promise.all([
      getSourceMediaInfo(file),
      tryTrackAnalysis(mediaId, file),
    ])
    const analysis = analyzed || { audioTrackCount: sourceInfo.audioTrackCount, ktvTrack: null }
    return {
      kind: 'json',
      mimeType: 'application/json',
      cacheControl: 'no-store',
      body: {
        audioTrackCount: sourceInfo.audioTrackCount,
        videoMimeType: mimeType || null,
        videoCodec: sourceInfo.videoCodec,
        audioTracks: [0, 1].map((requestedTrack) => {
          const track = getPhysicalAudioTrack(requestedTrack, analysis.audioTrackCount, analysis.ktvTrack)
          return track === null ? null : sourceInfo.audioTracks[track]
        }),
      },
    }
  }

  if (type === 'sourceAudio') {
    const [sourceInfo, analyzed] = await Promise.all([
      getSourceMediaInfo(file),
      tryTrackAnalysis(mediaId, file),
    ])
    const analysis = analyzed || { audioTrackCount: sourceInfo.audioTrackCount, ktvTrack: null }
    const audioTrack = getPhysicalAudioTrack(parseTrack(query.audioTrack), analysis.audioTrackCount, analysis.ktvTrack)
    const format = audioTrack === null ? undefined : sourceInfo.audioTracks[audioTrack]
    if (!format) throw new MediaRequestError(404, 'Source audio track not found')
    const sourceAudio = await getSourceAudio(file, mediaId, audioTrack, format)
    const stats = await fsPromises.stat(sourceAudio.file)
    return fileResponse(sourceAudio.file, sourceAudio.mimeType, stats.size, undefined, 'no-store')
  }

  if (type === 'video' || type === 'videoAudio' || type === 'videoCombined') {
    const [bundle, analyzed] = await Promise.all([
      type === 'videoAudio' ? getBrowserAudio(file, mediaId) : getBrowserMedia(file, mediaId),
      tryTrackAnalysis(mediaId, file),
    ])
    const analysis = analyzed || { audioTrackCount: bundle.audio.length, ktvTrack: null }

    if (type === 'videoCombined') {
      const track = getPhysicalAudioTrack(parseTrack(query.audioTrack), analysis.audioTrackCount, analysis.ktvTrack)
      const combined = track === null ? undefined : bundle.combined[track]
      if (!combined) throw new MediaRequestError(404, 'Combined audio track not found')
      const stats = await fsPromises.stat(combined)
      return fileResponse(combined, 'video/mp4', stats.size, undefined, 'no-store')
    }
    if (type === 'videoAudio') {
      const track = getPhysicalAudioTrack(parseTrack(query.audioTrack), analysis.audioTrackCount, analysis.ktvTrack)
      const files = query.audioFormat === 'aac' ? bundle.audioAac : bundle.audio
      const audio = track === null ? undefined : files[track]
      if (!audio) throw new MediaRequestError(404, 'Audio track not found')
      const stats = await fsPromises.stat(audio)
      return fileResponse(audio, fileTypes[getExt(audio)]?.mimeType || 'audio/mpeg', stats.size, undefined, 'no-store')
    }
    if (!bundle.video) throw new MediaRequestError(500, 'Browser video not found')
    const stats = await fsPromises.stat(bundle.video)
    return fileResponse(bundle.video, 'video/mp4', stats.size, undefined, 'no-store')
  }

  if (!mimeType) throw new MediaRequestError(404, `Unknown MIME type: ${file}`)
  return fileResponse(file, mimeType, length, buffer)
}

export function getPhysicalAudioTrack (
  requestedTrack: number,
  audioTrackCount: number,
  ktvTrack: 0 | 1 | null,
): 0 | 1 | null {
  if (requestedTrack !== 0 && requestedTrack !== 1) return null
  if (audioTrackCount < 2) return 0
  if (ktvTrack === null) return requestedTrack
  return requestedTrack === 1 ? ktvTrack : (ktvTrack === 0 ? 1 : 0)
}

async function resolveScript (source: string): Promise<ResolvedMediaRequest> {
  const script = path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.srt`)
  try {
    const stats = await fsPromises.stat(script)
    return fileResponse(script, 'application/x-subrip; charset=utf-8', stats.size, undefined, 'no-store')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new MediaRequestError(404, 'No script available')
    }
    throw error
  }
}

async function resolveArchive (file: string, type: string): Promise<{ buffer: Buffer, mimeType: string }> {
  const { entries } = await unzip(new Uint8Array(await fsPromises.readFile(file)))
  const entryName = type === 'cdg'
    ? Object.keys(entries).find(name => !name.includes('/') && getExt(name) === '.cdg')
    : Object.keys(entries).find(name => !name.includes('/') && audioExts.includes(getExt(name)))
  if (!entryName) {
    throw new MediaRequestError(404, type === 'cdg' ? 'No .cdg file found in archive' : 'No valid audio file found in archive')
  }
  const mimeType = fileTypes[getExt(entryName)]?.mimeType
  if (!mimeType) throw new MediaRequestError(404, `Unknown MIME type: ${entryName}`)
  return { buffer: Buffer.from(await entries[entryName].arrayBuffer()), mimeType }
}

async function tryTrackAnalysis (mediaId: number, file: string) {
  return ensureAudioTrackAnalysis(mediaId, file).catch((error) => {
    log.warn('Audio track analysis failed for mediaId=%s; using track order: %s', mediaId, error.message)
    return null
  })
}

function fileResponse (
  file: string,
  mimeType: string,
  length: number,
  buffer?: Buffer,
  cacheControl?: string,
): ResolvedMediaRequest {
  return { kind: 'file', file, buffer, length, mimeType, cacheControl }
}

function parseTrack (value: unknown): number {
  return parseInt(String(value || '0'), 10)
}
