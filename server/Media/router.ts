import fs from 'fs'
import fsPromises from 'node:fs/promises'
import { Readable } from 'stream'
import path from 'path'
import { unzip } from 'unzipit'
import getLogger from '../lib/Log.js'
import getCdgName from '../lib/getCdgName.js'
import { getExt } from '../lib/util.js'
import KoaRouter from '@koa/router'
import Library from '../Library/Library.js'
import Media from './Media.js'
import Prefs from '../Prefs/Prefs.js'
import Queue from '../Queue/Queue.js'
import Rooms from '../Rooms/Rooms.js'
import fileTypes from './fileTypes.js'
import { getBrowserAudio, getBrowserMedia, getSourceAudio, getSourceMediaInfo, prefetchBrowserMedia } from './Transcoder.js'
import { ensureAudioTrackAnalysis, scheduleAudioTrackAnalysis } from './AudioTrackAnalysis.js'
import { LIBRARY_PUSH_SONG, QUEUE_PUSH } from '../../shared/actionTypes.js'
const log = getLogger('Media')
const router = new KoaRouter({ prefix: '/api/media' })

const audioExts = Object.keys(fileTypes).filter(ext => fileTypes[ext].mimeType.startsWith('audio/'))
const configuredPrecacheCount = parseInt(process.env.KES_PRECACHE_COUNT || '5', 10)
const precacheCount = Number.isInteger(configuredPrecacheCount)
  ? Math.min(Math.max(configuredPrecacheCount, 0), 100)
  : 5

// Queue upcoming videos for background conversion. The player sends its real
// round-robin playback order, which the server cannot infer from the raw queue.
router.post('/precache', async (ctx) => {
  requireRoomMember(ctx)

  const body = ctx.request.body as { mediaIds?: unknown, videoTypes?: unknown, audioTypes?: unknown }
  const requested = body?.mediaIds
  if (!Array.isArray(requested)) ctx.throw(422, 'mediaIds must be an array')
  const requestedIds = requested as unknown[]

  const mediaIds = [...new Set(requestedIds
    .filter((mediaId): mediaId is number => Number.isInteger(mediaId))
    .slice(0, precacheCount))]
  const videoTypes = supportedTypes(body.videoTypes)
  const audioTypes = supportedTypes(body.audioTypes)
  const items: { source: string, mediaId: number, prepareVideo: boolean }[] = []
  const { paths } = Prefs.get()

  for (const mediaId of mediaIds) {
    const res = Media.search({ mediaId })
    if (!res.result.length) continue

    const { pathId, relPath } = res.entities[mediaId]
    const file = path.join(paths.entities[pathId].path, relPath)
    const mimeType = fileTypes[getExt(file)]?.mimeType
    if (!mimeType?.startsWith('video/')) continue
    const sourceInfo = await getSourceMediaInfo(file)
    const canStreamVideo = supportsType(videoTypes, mimeType, sourceInfo.videoCodec)
    const canStreamAudio = sourceInfo.audioTracks.length > 0
      && sourceInfo.audioTracks.every(track => supportsType(audioTypes, track.mimeType, track.codec))
    if (!canStreamVideo || !canStreamAudio) {
      items.push({ source: file, mediaId, prepareVideo: !canStreamVideo })
    }
    scheduleAudioTrackAnalysis(mediaId, file)
  }

  prefetchBrowserMedia(items)
  ctx.status = 202
})

// stream a media file
router.get('/:mediaId', async (ctx) => {
  const { type } = ctx.query

  requireRoomMember(ctx)

  const mediaId = parseInt(ctx.params.mediaId, 10)

  if (Number.isNaN(mediaId) || !type) {
    ctx.throw(422, 'invalid mediaId or type')
  }

  // get media info
  const res = Media.search({ mediaId })

  if (!res.result.length) {
    ctx.throw(404, 'mediaId not found')
  }

  const { pathId, relPath } = res.entities[mediaId]

  // get base path
  const { paths } = Prefs.get()
  const basePath = paths.entities[pathId].path

  let file = path.join(basePath, relPath)
  let buffer

  if (type === 'script') {
    const script = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.srt`)
    try {
      const stats = await fsPromises.stat(script)
      ctx.length = stats.size
      ctx.type = 'application/x-subrip; charset=utf-8'
      ctx.set('Cache-Control', 'no-store')
      streamMedia(ctx, script, undefined, stats.size)
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') ctx.throw(404, 'No script available')
      throw err
    }
    return
  }

  if (getExt(file) === '.zip') {
    const { entries } = await unzip(new Uint8Array(await fsPromises.readFile(file)))
    let entry

    if (type === 'cdg') {
      entry = Object.keys(entries).find(f => !f.includes('/') && getExt(f) === '.cdg')
      if (!entry) ctx.throw(404, 'No .cdg file found in archive')
    } else {
      entry = Object.keys(entries).find(f => !f.includes('/') && audioExts.includes(getExt(f)))
      if (!entry) ctx.throw(404, 'No valid audio file found in archive')
    }

    ctx.length = entries[entry].size
    ctx.type = fileTypes[getExt(entry)]?.mimeType
    buffer = Buffer.from(await entries[entry].arrayBuffer())
  } else {
    if (type === 'cdg') {
      file = getCdgName(file)
      if (!file) ctx.throw(404, 'The .cdg file could not be found')
    }

    const stats = await fsPromises.stat(file)
    ctx.length = stats.size
    ctx.type = fileTypes[getExt(file)]?.mimeType
  }

  if (type === 'sourceVideo') {
    if (!ctx.type?.startsWith('video/')) ctx.throw(422, 'Source is not a video')
    ctx.set('Cache-Control', 'no-store')
  }

  if (type === 'videoInfo') {
    ctx.set('Cache-Control', 'no-store')
    const [sourceInfo, analyzed] = await Promise.all([
      getSourceMediaInfo(file),
      ensureAudioTrackAnalysis(mediaId, file).catch((err) => {
        log.warn('Audio track analysis failed for mediaId=%s; using track order: %s', mediaId, err.message)
        return null
      }),
    ])
    const analysis = analyzed || { audioTrackCount: sourceInfo.audioTrackCount, ktvTrack: null }
    ctx.body = {
      audioTrackCount: sourceInfo.audioTrackCount,
      videoMimeType: ctx.type,
      videoCodec: sourceInfo.videoCodec,
      audioTracks: [0, 1].map((requestedTrack) => {
        const track = getPhysicalAudioTrack(requestedTrack, analysis.audioTrackCount, analysis.ktvTrack)
        return track === null ? null : sourceInfo.audioTracks[track]
      }),
    }
    ctx.type = 'application/json'
    return
  }

  if (type === 'sourceAudio') {
    ctx.set('Cache-Control', 'no-store')
    const [sourceInfo, analyzed] = await Promise.all([
      getSourceMediaInfo(file),
      ensureAudioTrackAnalysis(mediaId, file).catch((err) => {
        log.warn('Audio track analysis failed for mediaId=%s; using track order: %s', mediaId, err.message)
        return null
      }),
    ])
    const analysis = analyzed || { audioTrackCount: sourceInfo.audioTrackCount, ktvTrack: null }
    const requestedTrack = parseInt(String(ctx.query.audioTrack || '0'), 10)
    const audioTrack = getPhysicalAudioTrack(requestedTrack, analysis.audioTrackCount, analysis.ktvTrack)
    const format = audioTrack === null ? undefined : sourceInfo.audioTracks[audioTrack]
    if (!format) ctx.throw(404, 'Source audio track not found')
    const sourceAudio = await getSourceAudio(file, mediaId, audioTrack, format)
    file = sourceAudio.file
    ctx.type = sourceAudio.mimeType
    const stats = await fsPromises.stat(file)
    ctx.length = stats.size
    buffer = undefined
  }

  if (['video', 'videoAudio', 'videoCombined'].includes(String(type))) {
    // Browser media is versioned on the client and cached on disk by the
    // server. Prevent browser/proxy caches from mixing old audio container
    // bytes with the current response MIME type.
    ctx.set('Cache-Control', 'no-store')
    const [bundle, analyzed] = await Promise.all([
      type === 'videoAudio' ? getBrowserAudio(file, mediaId) : getBrowserMedia(file, mediaId),
      ensureAudioTrackAnalysis(mediaId, file).catch((err) => {
        log.warn('Audio track analysis failed for mediaId=%s; using track order: %s', mediaId, err.message)
        return null
      }),
    ])
    const analysis = analyzed || {
      audioTrackCount: bundle.audio.length,
      ktvTrack: null,
    }

    if (type === 'videoCombined') {
      const requestedTrack = parseInt(String(ctx.query.audioTrack || '0'), 10)
      const audioTrack = getPhysicalAudioTrack(requestedTrack, analysis.audioTrackCount, analysis.ktvTrack)
      const combinedFile = audioTrack === null ? undefined : bundle.combined[audioTrack]
      if (!combinedFile) {
        ctx.throw(404, 'Combined audio track not found')
      }
      file = combinedFile
      ctx.type = 'video/mp4'
    } else if (type === 'videoAudio') {
      const requestedTrack = parseInt(String(ctx.query.audioTrack || '0'), 10)
      const audioTrack = getPhysicalAudioTrack(requestedTrack, analysis.audioTrackCount, analysis.ktvTrack)
      const audioFiles = ctx.query.audioFormat === 'aac' ? bundle.audioAac : bundle.audio
      const audioFile = audioTrack === null ? undefined : audioFiles[audioTrack]
      if (!audioFile) {
        ctx.throw(404, 'Audio track not found')
      }
      file = audioFile
      ctx.type = fileTypes[getExt(file)]?.mimeType || 'audio/mpeg'
    } else {
      if (!bundle.video) ctx.throw(500, 'Browser video not found')
      file = bundle.video
      ctx.type = 'video/mp4'
    }

    const stats = await fsPromises.stat(file)
    ctx.length = stats.size
    buffer = undefined
  }

  if (!ctx.type) ctx.throw(404, `Unknown MIME type: ${file}`)

  log.verbose('streaming %s (%sMB): %s', ctx.type, (ctx.length / 1000000).toFixed(2), file)
  streamMedia(ctx, file, buffer, ctx.length)
})

// set isPreferred flag
router.all('/:mediaId/prefer', (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  const mediaId = parseInt(ctx.params.mediaId, 10)

  if (Number.isNaN(mediaId) || (ctx.request.method !== 'PUT' && ctx.request.method !== 'DELETE')) {
    ctx.throw(422)
  }

  const songId = Media.setPreferred(mediaId, ctx.request.method === 'PUT')
  ctx.status = 200

  // emit (potentially) updated queues to each room
  for (const { room, roomId } of Rooms.getActive(ctx.io)) {
    ctx.io.to(room).emit('action', {
      type: QUEUE_PUSH,
      payload: Queue.get(roomId),
    })
  }

  // emit (potentially) new duration
  ctx.io.emit('action', {
    type: LIBRARY_PUSH_SONG,
    payload: Library.getSong(songId),
  })
})

export default router

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

function supportedTypes (value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((type): type is string => typeof type === 'string') : [])
}

function supportsType (types: Set<string>, mimeType: string | null | undefined, codec: string | null): boolean {
  return !!mimeType && !!codec && types.has(`${mimeType}; codecs="${codec}"`)
}

function streamMedia (ctx, file: string, buffer: Buffer | undefined, length: number) {
  ctx.set('Accept-Ranges', 'bytes')
  const range = ctx.request.headers.range

  if (!range) {
    ctx.body = buffer ? Readable.from(buffer) : fs.createReadStream(file)
    return
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (!match[1] && !match[2])) {
    ctx.set('Content-Range', `bytes */${length}`)
    ctx.throw(416, 'Invalid byte range')
  }

  let start: number
  let end: number

  if (!match[1]) {
    const suffixLength = parseInt(match[2], 10)
    start = Math.max(length - suffixLength, 0)
    end = length - 1
  } else {
    start = parseInt(match[1], 10)
    end = match[2] ? parseInt(match[2], 10) : length - 1
  }

  if (start >= length || start > end) {
    ctx.set('Content-Range', `bytes */${length}`)
    ctx.throw(416, 'Byte range is outside the media file')
  }

  end = Math.min(end, length - 1)
  ctx.status = 206
  ctx.set('Content-Range', `bytes ${start}-${end}/${length}`)
  ctx.length = end - start + 1
  ctx.body = buffer
    ? Readable.from(buffer.subarray(start, end + 1))
    : fs.createReadStream(file, { start, end })
}

function requireRoomMember (ctx): void {
  if (typeof ctx.user?.userId !== 'number' || typeof ctx.user?.roomId !== 'number') {
    ctx.throw(401, 'Join a room before accessing media')
  }
}
