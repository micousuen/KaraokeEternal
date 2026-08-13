import KoaRouter from '@koa/router'
import { YOUTUBE_JOBS_PUSH } from '../../shared/actionTypes.js'
import { publishQueue } from '../Queue/QueuePublisher.js'
import { roomSockets } from '../lib/socketRooms.js'
import { createYouTubeJob, getRoomYouTubeJobs, getYouTubeJob, searchYouTube } from './YouTube.js'

interface RequestWithBody {
  body: { url?: unknown }
}

const router = new KoaRouter({ prefix: '/api/youtube' })
const searchRates = new Map<number, { count: number, startedAt: number }>()
const SEARCHES_PER_MINUTE = 12

router.get('/search', async (ctx) => {
  requireRoomMember(ctx)
  enforceSearchRate(ctx)

  const query = typeof ctx.query.q === 'string' ? ctx.query.q : ''
  try {
    ctx.body = await searchYouTube(query, {
      maxDuration: ctx.env.KES_YOUTUBE_MAX_DURATION,
      providerUrl: ctx.env.KES_YOUTUBE_POT_PROVIDER_URL,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/at least two|limited to 120/.test(message)) ctx.throw(422, message)
    if (/search service is busy/.test(message)) ctx.throw(429, message)
    if (/timed out/.test(message)) ctx.throw(504, message)
    if (/ENOENT.*yt-dlp|spawn yt-dlp|Could not start yt-dlp/i.test(message)) {
      ctx.throw(503, 'YouTube search is not installed on this server')
    }
    ctx.throw(502, `YouTube search failed: ${message.split(/\r?\n/).pop()?.slice(0, 300) || 'unknown error'}`)
  }
})

router.post('/', (ctx) => {
  if (typeof ctx.user?.userId !== 'number' || typeof ctx.user?.roomId !== 'number') {
    ctx.throw(401, 'Join a room before importing a YouTube video')
  }

  const url = (ctx.request as unknown as RequestWithBody).body.url
  if (typeof url !== 'string' || !url.trim()) ctx.throw(422, 'Enter a YouTube video URL')
  const normalizedInput = String(url).trim()

  try {
    const roomId = ctx.user.roomId
    const room = roomSockets(roomId)
    const pushJobs = () => ctx.io.to(room).emit('action', {
      type: YOUTUBE_JOBS_PUSH,
      payload: getRoomYouTubeJobs(roomId),
    })
    const job = createYouTubeJob(normalizedInput, {
      roomId,
      userId: ctx.user.userId,
      userDisplayName: ctx.user.name,
      userDateUpdated: ctx.user.dateUpdated,
    }, {
      downloadsPath: ctx.env.KES_PATH_DOWNLOADS,
      maxDuration: ctx.env.KES_YOUTUBE_MAX_DURATION,
      providerUrl: ctx.env.KES_YOUTUBE_POT_PROVIDER_URL,
      startScanner: ctx.startScanner,
      pushJobs,
      pushQueue: () => publishQueue(ctx.io, roomId),
    })
    ctx.status = 202
    ctx.body = job
  } catch (error) {
    ctx.throw(/queue is busy/.test(error.message) ? 429 : 422, error.message)
  }
})

router.get('/:jobId', (ctx) => {
  if (typeof ctx.user?.userId !== 'number') ctx.throw(401)
  const job = getYouTubeJob(ctx.params.jobId, ctx.user.userId)
  if (!job) ctx.throw(404, 'YouTube download job not found')
  ctx.body = job
})

export default router

function requireRoomMember (ctx): void {
  if (typeof ctx.user?.userId !== 'number' || typeof ctx.user?.roomId !== 'number') {
    ctx.throw(401, 'Join a room before searching YouTube')
  }
}

function enforceSearchRate (ctx): void {
  const userId = ctx.user.userId as number
  const now = Date.now()
  const current = searchRates.get(userId)
  const rate = !current || now - current.startedAt >= 60_000
    ? { count: 0, startedAt: now }
    : current
  rate.count++
  searchRates.set(userId, rate)
  if (rate.count > SEARCHES_PER_MINUTE) {
    ctx.throw(429, 'Too many YouTube searches; try again shortly')
  }

  if (searchRates.size > 10_000) {
    for (const [id, entry] of searchRates) {
      if (now - entry.startedAt >= 60_000) searchRates.delete(id)
    }
    while (searchRates.size > 10_000) searchRates.delete(searchRates.keys().next().value!)
  }
}
