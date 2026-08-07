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
import { getBrowserMedia, prefetchBrowserMedia } from './Transcoder.js'
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
router.post('/precache', (ctx) => {
  requireRoomMember(ctx)

  const requested = (ctx.request.body as { mediaIds?: unknown })?.mediaIds
  if (!Array.isArray(requested)) ctx.throw(422, 'mediaIds must be an array')
  const requestedIds = requested as unknown[]

  const mediaIds = [...new Set(requestedIds
    .filter((mediaId): mediaId is number => Number.isInteger(mediaId))
    .slice(0, precacheCount))]
  const items: { source: string, mediaId: number }[] = []
  const { paths } = Prefs.get()

  for (const mediaId of mediaIds) {
    const res = Media.search({ mediaId })
    if (!res.result.length) continue

    const { pathId, relPath } = res.entities[mediaId]
    const file = path.join(paths.entities[pathId].path, relPath)
    if (!fileTypes[getExt(file)]?.mimeType.startsWith('video/')) continue
    items.push({ source: file, mediaId })
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

  if (['video', 'videoAudio', 'videoInfo'].includes(String(type))) {
    const bundle = await getBrowserMedia(file, mediaId)

    if (type === 'videoInfo') {
      ctx.body = { audioTrackCount: bundle.audio.length }
      ctx.type = 'application/json'
      return
    }

    if (type === 'videoAudio') {
      const audioTrack = parseInt(String(ctx.query.audioTrack || '0'), 10)
      if (!Number.isInteger(audioTrack) || !bundle.audio[audioTrack]) {
        ctx.throw(404, 'Audio track not found')
      }
      file = bundle.audio[audioTrack]
      ctx.type = fileTypes[getExt(file)]?.mimeType || 'audio/mpeg'
    } else {
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
