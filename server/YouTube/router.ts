import KoaRouter from '@koa/router'
import Queue from '../Queue/Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { QUEUE_PUSH, YOUTUBE_JOBS_PUSH } from '../../shared/actionTypes.js'
import { createYouTubeJob, getRoomYouTubeJobs, getYouTubeJob } from './YouTube.js'

interface RequestWithBody {
  body: { url?: unknown }
}

const router = new KoaRouter({ prefix: '/api/youtube' })

router.post('/', (ctx) => {
  if (typeof ctx.user?.userId !== 'number' || typeof ctx.user?.roomId !== 'number') {
    ctx.throw(401, 'Join a room before importing a YouTube video')
  }

  const url = (ctx.request as unknown as RequestWithBody).body.url
  if (typeof url !== 'string' || !url.trim()) ctx.throw(422, 'Enter a YouTube video URL')
  const normalizedInput = String(url).trim()

  try {
    const roomId = ctx.user.roomId
    const room = Rooms.prefix(roomId)
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
      pushQueue: () => ctx.io.to(room).emit('action', {
        type: QUEUE_PUSH,
        payload: Queue.get(roomId),
      }),
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
