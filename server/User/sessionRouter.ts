import KoaRouter from '@koa/router'
import sql from 'sqlate'
import { db } from '../lib/Database.js'
import crypto from '../lib/crypto.js'
import Prefs from '../Prefs/Prefs.js'
import Rooms from '../Rooms/Rooms.js'
import User from './User.js'
import { createUserContext, setUserCookie } from './UserContext.js'
import { guardLogin, loginAttemptKey, LoginRateLimitError } from './LoginGuard.js'

interface SessionRequest {
  body: Record<string, any>
}

const router = new KoaRouter()

router.post('/login', async (ctx) => {
  const req = ctx.request as unknown as SessionRequest
  const roomId = parseInt(req.body.roomId, 10) || null
  let user

  try {
    user = await guardLogin(loginAttemptKey(ctx.ip, req.body.username), async () => {
      const validatedUser = await User.validate(req.body as any)
      if (roomId) await Rooms.validate(roomId, req.body.roomPassword, { validatePassword: true })
      else if (validatedUser.role !== 'admin') throw new Error('An admin account is required outside a room invite')
      return validatedUser
    })
  } catch (err) {
    if (err instanceof LoginRateLimitError) ctx.throw(err.status, err.message)
    ctx.throw(401, err.message)
  }

  if (crypto.isLegacy(user.password)) {
    const newHash = await crypto.hash(req.body.password)
    const query = sql`
      UPDATE users
      SET password = ${newHash}, dateUpdated = ${Math.max(Math.floor(Date.now() / 1000), (user.dateUpdated || 0) + 1)}
      WHERE userId = ${user.userId}
    `
    db.run(String(query), query.parameters)
    user = User.getById(user.userId, true)
    if (!user) ctx.throw(401, 'Account no longer exists')
  }

  const userContext = createUserContext(user, roomId)
  setUserCookie(ctx, userContext)
  ctx.body = userContext
})

router.get('/logout', (ctx) => {
  ctx.cookies.set('keToken', '')
  ctx.status = 200
  ctx.body = {}
})

router.get('/user', (ctx) => {
  if (typeof ctx.user.userId !== 'number') ctx.throw(401)
  const user = User.getById(ctx.user.userId, true)
  if (!user) ctx.throw(404)

  let roomId = ctx.user.roomId
  if (typeof roomId === 'number' && !Rooms.get(roomId, { status: [] }).entities[roomId]) {
    if (!ctx.user.isAdmin) ctx.throw(401, 'Room no longer exists')
    roomId = null
  }

  const userContext = createUserContext(user, roomId)
  if (roomId !== ctx.user.roomId) setUserCookie(ctx, userContext)
  ctx.body = userContext
})

router.post('/setup', async (ctx) => {
  const prefs: any = Prefs.get()
  if (prefs.isFirstRun !== true) ctx.throw(403)

  try {
    const req = ctx.request as unknown as SessionRequest
    const userId = await User.create(req.body as any, 'admin')
    const user = User.getById(userId, true)
    if (!user) throw new Error('User not found')

    const userContext = createUserContext(user, null)
    setUserCookie(ctx, userContext)
    const query = sql`UPDATE prefs SET data = 'false' WHERE key = 'isFirstRun'`
    db.run(String(query))
    ctx.body = userContext
  } catch (err) {
    ctx.throw(403, err.message)
  }
})

export default router
