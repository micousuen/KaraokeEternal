import KoaRouter from '@koa/router'
import Media from '../Media/Media.js'
import pushQueuesAndLibrary from '../lib/pushQueuesAndLibrary.js'
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

export default router
