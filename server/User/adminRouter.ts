import KoaRouter from '@koa/router'
import User from './User.js'
import { publishAllQueues } from '../Queue/QueuePublisher.js'
import { userSockets } from '../lib/socketRooms.js'
import { getUserRooms } from './PresenceRegistry.js'

const router = new KoaRouter()

router.get('/users', (ctx) => {
  if (!ctx.user.isAdmin) ctx.throw(401)

  const users = User.get()
  users.result.forEach((userId) => {
    users.entities[userId].rooms = getUserRooms(userId)
  })
  ctx.body = users
})

router.delete('/user/:userId', async (ctx) => {
  const targetId = parseInt(ctx.params.userId, 10)
  if (!ctx.user.isAdmin || targetId === ctx.user.userId) ctx.throw(403)

  User.remove(targetId)
  ctx.io.in(userSockets(targetId)).disconnectSockets(true)

  publishAllQueues(ctx.io)
  ctx.status = 200
  ctx.body = {}
})

export default router
