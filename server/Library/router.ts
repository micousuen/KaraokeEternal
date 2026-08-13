import KoaRouter from '@koa/router'
import path from 'node:path'
import Media from '../Media/Media.js'
import Library from './Library.js'
import fileTypes from '../Media/fileTypes.js'
import { forceMediaProcessing } from '../Media/AudioTrackAnalysis.js'
import { getExt } from '../lib/util.js'
import pushQueuesAndLibrary from '../lib/pushQueuesAndLibrary.js'
import { LIBRARY_PUSH_SONG } from '../../shared/actionTypes.js'
const router = new KoaRouter({ prefix: '/api' })

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
        Library.cache.version = null
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

export default router
