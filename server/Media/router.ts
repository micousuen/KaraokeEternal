import fs from 'fs'
import path from 'path'
import getLogger from '../lib/Log.js'
import { getExt } from '../lib/util.js'
import KoaRouter from '@koa/router'
import Library from '../Library/Library.js'
import Media from './Media.js'
import Prefs from '../Prefs/Prefs.js'
import fileTypes from './fileTypes.js'
import { getSourceMediaInfo, prefetchBrowserMedia, type BrowserMediaPrefetch } from './Transcoder.js'
import { scheduleAudioTrackAnalysis } from './AudioTrackAnalysis.js'
import { resolveMediaRequest } from './MediaRequestResolver.js'
import { LIBRARY_PUSH_SONG } from '../../shared/actionTypes.js'
import { publishAllQueues } from '../Queue/QueuePublisher.js'
const log = getLogger('Media')
const router = new KoaRouter({ prefix: '/api/media' })

const configuredPrecacheCount = parseInt(process.env.KES_PRECACHE_COUNT || '5', 10)
const precacheCount = Number.isInteger(configuredPrecacheCount)
  ? Math.min(Math.max(configuredPrecacheCount, 0), 100)
  : 5

// Queue upcoming videos for background conversion. The player sends its real
// round-robin playback order, which the server cannot infer from the raw queue.
router.post('/precache', async (ctx) => {
  requireRoomMember(ctx)

  const body = ctx.request.body as {
    mediaIds?: unknown
    videoTypes?: unknown
    audioTypes?: unknown
    combinedPlayback?: unknown
  }
  const requested = body?.mediaIds
  if (!Array.isArray(requested)) ctx.throw(422, 'mediaIds must be an array')
  const requestedIds = requested as unknown[]

  const mediaIds = [...new Set(requestedIds
    .filter((mediaId): mediaId is number => Number.isInteger(mediaId))
    .slice(0, precacheCount))]
  const videoTypes = supportedTypes(body.videoTypes)
  const audioTypes = supportedTypes(body.audioTypes)
  const combinedPlayback = body.combinedPlayback === true
  const items: BrowserMediaPrefetch[] = []
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
    const unsupportedAudioTracks = sourceInfo.audioTracks
      .map((track, index) => supportsType(audioTypes, track.mimeType, track.codec) ? -1 : index)
      .filter(index => index >= 0)
    if (combinedPlayback || !canStreamVideo || unsupportedAudioTracks.length) {
      items.push({
        source: file,
        mediaId,
        prepareVideo: combinedPlayback || !canStreamVideo,
        prepareCombined: combinedPlayback,
        audioFormat: combinedPlayback ? 'aac' : 'mp3',
        audioTracks: combinedPlayback
          ? sourceInfo.audioTracks.map((_, index) => index)
          : unsupportedAudioTracks,
      })
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

  const resolved = await resolveMediaRequest(mediaId, String(type), ctx.query)
  if (resolved.cacheControl) ctx.set('Cache-Control', resolved.cacheControl)
  ctx.type = resolved.mimeType
  if (resolved.kind === 'json') {
    ctx.body = resolved.body
    return
  }
  ctx.length = resolved.length!
  log.verbose('streaming %s (%sMB): %s', ctx.type, (ctx.length / 1000000).toFixed(2), resolved.file)
  streamMedia(ctx, resolved.file!, resolved.length!)
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
  publishAllQueues(ctx.io)

  // emit (potentially) new duration
  ctx.io.emit('action', {
    type: LIBRARY_PUSH_SONG,
    payload: Library.getSong(songId),
  })
})

export default router

export { getPhysicalAudioTrack } from './MediaRequestResolver.js'

function supportedTypes (value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((type): type is string => typeof type === 'string') : [])
}

function supportsType (types: Set<string>, mimeType: string | null | undefined, codec: string | null): boolean {
  return !!mimeType && !!codec && types.has(`${mimeType}; codecs="${codec}"`)
}

function streamMedia (ctx, file: string, length: number) {
  ctx.set('Accept-Ranges', 'bytes')
  const range = ctx.request.headers.range

  if (!range) {
    ctx.body = fs.createReadStream(file)
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
  ctx.body = fs.createReadStream(file, { start, end })
}

function requireRoomMember (ctx): void {
  if (typeof ctx.user?.userId !== 'number' || typeof ctx.user?.roomId !== 'number') {
    ctx.throw(401, 'Join a room before accessing media')
  }
}
