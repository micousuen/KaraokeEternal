import KoaRouter from '@koa/router'
import { promisify } from 'node:util'
import { brotliCompress, gzip } from 'node:zlib'
import path from 'node:path'
import Media from '../Media/Media.js'
import Library from './Library.js'
import fileTypes from '../Media/fileTypes.js'
import { forceMediaProcessing } from '../Media/AudioTrackAnalysis.js'
import { getExt } from '../lib/util.js'
import pushQueuesAndLibrary from '../lib/pushQueuesAndLibrary.js'
import { LIBRARY_PUSH_SONG } from '../../shared/actionTypes.js'
import { findScriptRegenerationCandidates } from './ScriptRegeneration.js'
const router = new KoaRouter({ prefix: '/api' })
const compressBrotli = promisify(brotliCompress)
const compressGzip = promisify(gzip)
let encodedLibrary: {
  version: number
  json: Buffer
  br?: Promise<Buffer>
  gzip?: Promise<Buffer>
} | undefined

router.get('/library', async (ctx) => {
  const library = await Library.getAsync()
  const etag = `"library-${library.version}"`
  ctx.set('Cache-Control', 'private, no-cache')
  ctx.set('ETag', etag)
  ctx.set('Vary', 'Accept-Encoding')
  if (ctx.get('If-None-Match') === etag) {
    ctx.status = 304
    return
  }

  if (!encodedLibrary || encodedLibrary.version !== library.version) {
    encodedLibrary = {
      version: library.version!,
      json: Buffer.from(JSON.stringify(library)),
    }
  }
  const acceptEncoding = ctx.acceptsEncodings('br', 'gzip', 'identity')
  let body = encodedLibrary.json
  if (acceptEncoding === 'br') {
    encodedLibrary.br ||= compressBrotli(encodedLibrary.json)
    body = await encodedLibrary.br
    ctx.set('Content-Encoding', 'br')
  } else if (acceptEncoding === 'gzip') {
    encodedLibrary.gzip ||= compressGzip(encodedLibrary.json)
    body = await encodedLibrary.gzip
    ctx.set('Content-Encoding', 'gzip')
  }
  ctx.type = 'application/json'
  ctx.body = body
})

// lists underlying media for a given song
router.get('/song/:songId', async (ctx) => {
  // must be admin
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  const songId = parseInt(ctx.params.songId, 10)

  if (Number.isNaN(songId)) {
    ctx.throw(401, 'Invalid songId')
  }

  const res = Media.search({ songId })

  if (!res.result.length) {
    ctx.throw(404)
  }

  ctx.body = res
})

router.put('/song/:songId/name', async (ctx) => {
  if (!ctx.user.isAdmin) ctx.throw(401)
  const songId = parseInt(ctx.params.songId, 10)
  const body = ctx.request.body as { name?: unknown, artist?: unknown }
  const { name, artist } = body
  if (!Number.isInteger(songId) || typeof name !== 'string' || typeof artist !== 'string') {
    ctx.throw(422, 'Invalid song or author name')
  }
  const validatedName = String(name)
  const validatedArtist = String(artist)

  try {
    const result = await Media.renameSong(songId, validatedName, validatedArtist)
    pushQueuesAndLibrary(ctx.io)
    ctx.body = result
  } catch (err) {
    ctx.throw(422, err instanceof Error ? err.message : String(err))
  }
})

router.post('/song/:songId/regenerate', async (ctx) => {
  if (!ctx.user.isAdmin) ctx.throw(401)
  const songId = parseInt(ctx.params.songId, 10)
  const body = (ctx.request.body || {}) as { output?: unknown }
  if (!Number.isInteger(songId) || (body.output !== 'instrumental' && body.output !== 'script')) {
    ctx.throw(422, 'Invalid song or output type')
  }
  const output = body.output as 'instrumental' | 'script'

  const result = Media.search({ songId })
  if (!result.result.length) ctx.throw(404, 'Song not found')
  const videoIds = result.result.filter((mediaId) => {
    const candidate = result.entities[mediaId]
    return fileTypes[getExt(candidate.relPath)]?.mimeType.startsWith('video/')
  })
  if (!videoIds.length) ctx.throw(422, 'This song has no video media to process')
  const preferredId = videoIds.find(mediaId => !!result.entities[mediaId].isPreferred) || videoIds[0]
  const media = result.entities[preferredId]
  const source = path.resolve(media.path, media.relPath)

  const io = ctx.io
  try {
    await forceMediaProcessing(
      preferredId,
      media.pathId,
      source,
      output,
      () => {
        Library.invalidate()
        io.emit('action', {
          type: LIBRARY_PUSH_SONG,
          payload: Library.getSong(songId),
        })
      },
      ctx.suppressWatcher,
    )
    ctx.status = 202
    ctx.body = { mediaId: preferredId, output }
  } catch (err) {
    ctx.throw(422, err instanceof Error ? err.message : String(err))
  }
})

router.post('/library/scripts/regenerate', async (ctx) => {
  if (!ctx.user.isAdmin) ctx.throw(401)

  const candidates = findScriptRegenerationCandidates(Media.search({}))
  const io = ctx.io
  const suppressWatcher = ctx.suppressWatcher
  let queued = 0
  let skipped = 0
  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      await forceMediaProcessing(
        candidate.mediaId,
        candidate.pathId,
        candidate.source,
        'script',
        () => {
          Library.invalidate()
          io.emit('action', {
            type: LIBRARY_PUSH_SONG,
            payload: Library.getSong(candidate.songId),
          })
        },
        suppressWatcher,
        false,
      )
      queued++
    } catch (err) {
      skipped++
      if (errors.length < 5) errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  ctx.status = 202
  ctx.body = {
    eligible: candidates.length,
    queued,
    skipped,
    errors,
  }
})

export default router
