import KoaRouter from '@koa/router'
import { promisify } from 'node:util'
import { brotliCompress, gzip } from 'node:zlib'
import path from 'node:path'
import Media from '../Media/Media.js'
import Library from './Library.js'
import fileTypes from '../Media/fileTypes.js'
import { forceMediaProcessing } from '../Media/AudioTrackAnalysis.js'
import { renameManagedDownloadWithAi, isManagedDownloadSong } from '../YouTube/AiSongNaming.js'
import { getSongQueueReadiness } from '../Media/MediaQueueReadiness.js'
import { removeMediaArtifacts } from '../Media/Transcoder.js'
import {
  findInstrumentalRegenerationCandidates,
  findNameReparsingCandidates,
  findScriptRegenerationCandidates,
} from './DownloadRegeneration.js'
import Prefs from '../Prefs/Prefs.js'
import { getExt } from '../lib/util.js'
import getLogger from '../lib/Log.js'
import pushQueuesAndLibrary from '../lib/pushQueuesAndLibrary.js'
import { LIBRARY_PUSH_SONG } from '../../shared/actionTypes.js'
const log = getLogger('Library')
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

// rename a managed YouTube download using AI
router.post('/song/:songId/ai-rename', async (ctx) => {
  if (!ctx.user.isAdmin) ctx.throw(401)
  const songId = parseInt(ctx.params.songId, 10)
  if (!Number.isInteger(songId)) ctx.throw(422, 'Invalid songId')

  try {
    const result = await renameManagedDownloadWithAi(songId)
    pushQueuesAndLibrary(ctx.io)
    ctx.body = result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/Could not reach DeepSeek|timed out|DeepSeek song naming failed/.test(message)) {
      ctx.throw(502, message)
    }
    ctx.throw(422, message)
  }
})

// permanently delete a managed YouTube download song
router.delete('/song/:songId', async (ctx) => {
  if (!ctx.user.isAdmin) ctx.throw(401)
  const songId = parseInt(ctx.params.songId, 10)
  if (!Number.isInteger(songId)) ctx.throw(422, 'Invalid songId')

  if (!isManagedDownloadSong(songId)) ctx.throw(422, 'Only YouTube downloads can be deleted')
  if (getSongQueueReadiness(songId) === 'processing') {
    ctx.throw(422, 'This download is still processing; wait for it to finish')
  }

  try {
    const mediaIds = await Media.deleteSong(songId)
    void removeMediaArtifacts(mediaIds).catch((error) => {
      log.warn('Could not remove transcode cache for songId=%s: %s', songId, error.message)
    })
    pushQueuesAndLibrary(ctx.io)
    ctx.status = 204
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

// bulk regenerate processing outputs for managed YouTube downloads
router.post('/library/downloads/regenerate', async (ctx) => {
  if (!ctx.user.isAdmin) ctx.throw(401)
  const body = (ctx.request.body || {}) as { output?: unknown }
  const output = body.output
  if (output !== 'script' && output !== 'instrumental' && output !== 'name') {
    ctx.throw(422, 'Invalid output type')
  }
  const outputType = output as 'script' | 'instrumental' | 'name'
  if (outputType === 'name' && !Prefs.getDeepSeekApiKey()) {
    ctx.throw(422, 'Configure a DeepSeek API key in Admin > Preferences > Song Naming')
  }

  const io = ctx.io
  const suppressWatcher = ctx.suppressWatcher
  let eligible = 0
  let queued = 0
  let skipped = 0
  const errors: string[] = []

  if (outputType === 'name') {
    const songIds = findNameReparsingCandidates(Media.search({}))
    eligible = songIds.length
    for (const songId of songIds) {
      try {
        await renameManagedDownloadWithAi(songId)
        queued++
      } catch (err) {
        skipped++
        if (errors.length < 5) errors.push(err instanceof Error ? err.message : String(err))
      }
    }
    if (queued > 0) pushQueuesAndLibrary(io)
  } else {
    const candidates = outputType === 'script'
      ? findScriptRegenerationCandidates(Media.search({}))
      : findInstrumentalRegenerationCandidates(Media.search({}))
    eligible = candidates.length
    for (const candidate of candidates) {
      try {
        await forceMediaProcessing(
          candidate.mediaId,
          candidate.pathId,
          candidate.source,
          outputType,
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
  }

  ctx.status = 202
  ctx.body = {
    eligible,
    queued,
    skipped,
    errors,
  }
})

export default router
