import fsPromises from 'node:fs/promises'
import path from 'node:path'
import getLogger from '../lib/Log.js'
import { getExt } from '../lib/util.js'
import Media from './Media.js'
import Prefs from '../Prefs/Prefs.js'
import fileTypes from './fileTypes.js'
import { ensureAudioTrackAnalysis } from './AudioTrackAnalysis.js'
import {
  getBrowserAudioTrack,
  getBrowserCombined,
  getBrowserVideo,
  getSourceAudio,
  getSourceMediaInfo,
} from './Transcoder.js'

const log = getLogger('MediaRequestResolver')
export type ResolvedMediaRequest = {
  body?: object
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
  const file = path.join(basePath, relPath)

  if (type === 'script') return resolveScript(file)

  const stats = await fsPromises.stat(file)
  const length = stats.size
  const mimeType = fileTypes[getExt(file)]?.mimeType

  if (type === 'sourceVideo') {
    if (!mimeType?.startsWith('video/')) throw new MediaRequestError(422, 'Source is not a video')
    return fileResponse(file, mimeType, length, 'no-store')
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
    const sourceAudioTracks = sourceInfo.audioTracks.map((trackFormat, candidateTrack) => (
      trackFormat.extension && trackFormat.mimeType
        ? getSourceAudio(
            file,
            mediaId,
            candidateTrack,
            trackFormat,
            candidateTrack === audioTrack ? 'playback' : 'background',
          )
        : null
    ))
    const sourceAudio = await sourceAudioTracks[audioTrack]
    // Keep switching tracks instant, but do not make the current track wait
    // for the other stream-copy jobs to finish.
    void Promise.allSettled(sourceAudioTracks.filter((track): track is Promise<Awaited<ReturnType<typeof getSourceAudio>>> => track !== null))
    const stats = await fsPromises.stat(sourceAudio.file)
    return fileResponse(sourceAudio.file, sourceAudio.mimeType, stats.size, 'no-store')
  }

  if (type === 'video' || type === 'videoAudio' || type === 'videoCombined') {
    if (type === 'video') {
      const video = await getBrowserVideo(file, mediaId)
      const stats = await fsPromises.stat(video)
      return fileResponse(video, 'video/mp4', stats.size, 'no-store')
    }

    const [sourceInfo, analyzed] = await Promise.all([
      getSourceMediaInfo(file),
      tryTrackAnalysis(mediaId, file),
    ])
    const analysis = analyzed || { audioTrackCount: sourceInfo.audioTrackCount, ktvTrack: null }
    const track = getPhysicalAudioTrack(parseTrack(query.audioTrack), analysis.audioTrackCount, analysis.ktvTrack)
    if (track === null) throw new MediaRequestError(404, 'Audio track not found')

    if (type === 'videoCombined') {
      const combinedTracks = Array.from(
        { length: sourceInfo.audioTrackCount },
        (_, audioTrack) => getBrowserCombined(
          file,
          mediaId,
          audioTrack,
          audioTrack === track ? 'playback' : 'background',
        ),
      )
      const combined = await combinedTracks[track]
      // Both muxed variants share the same prepared H.264 video and AAC jobs.
      // Finish the alternate track in the background for immediate switching.
      void Promise.allSettled(combinedTracks)
      const stats = await fsPromises.stat(combined)
      return fileResponse(combined, 'video/mp4', stats.size, 'no-store')
    }

    const audioFormat = query.audioFormat === 'aac' ? 'aac' : 'mp3'
    const audioTracks = Array.from(
      { length: sourceInfo.audioTrackCount },
      (_, audioTrack) => getBrowserAudioTrack(
        file,
        mediaId,
        audioTrack,
        audioFormat,
        audioTrack === track ? 'playback' : 'background',
      ),
    )
    const audio = await audioTracks[track]
    void Promise.allSettled(audioTracks)
    const stats = await fsPromises.stat(audio.file)
    return fileResponse(audio.file, audio.mimeType, stats.size, 'no-store')
  }

  if (!mimeType) throw new MediaRequestError(404, `Unknown MIME type: ${file}`)
  return fileResponse(file, mimeType, length)
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
    return fileResponse(script, 'application/x-subrip; charset=utf-8', stats.size, 'no-store')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new MediaRequestError(404, 'No script available')
    }
    throw error
  }
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
  cacheControl?: string,
): ResolvedMediaRequest {
  return { kind: 'file', file, length, mimeType, cacheControl }
}

function parseTrack (value: unknown): number {
  return parseInt(String(value || '0'), 10)
}
