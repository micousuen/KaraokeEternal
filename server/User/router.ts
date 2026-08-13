import { promisify } from 'util'
import fs from 'fs'
import { db } from '../lib/Database.js'
import sql from 'sqlate'
import crypto from '../lib/crypto.js'
import KoaRouter from '@koa/router'
import Rooms from '../Rooms/Rooms.js'
import User from '../User/User.js'
import { publishAllQueues } from '../Queue/QueuePublisher.js'
import adminRouter from './adminRouter.js'
import { createUserContext, setUserCookie } from './UserContext.js'
import sessionRouter from './sessionRouter.js'
import {
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  NAME_MIN_LENGTH,
  NAME_MAX_LENGTH,
  IMG_MAX_LENGTH,
} from './User.js'

interface File {
  filepath: string
  size: number
}

interface RequestWithBody {
  body: Record<string, any>
  files?: Record<string, File | File[]>
}

const router = new KoaRouter({ prefix: '/api' })
const readFile = promisify(fs.readFile)
const deleteFile = promisify(fs.unlink)

// update a user account
router.put('/user/:userId', async (ctx) => {
  const targetId = parseInt(ctx.params.userId, 10)
  const user = User.getById(ctx.user.userId, true)

  // must be admin if updating another user
  if (!user) {
    ctx.throw(401)
    return
  }

  if (targetId !== user.userId && user.role !== 'admin') {
    ctx.throw(401)
    return
  }

  const req = ctx.request as unknown as RequestWithBody
  let { name, username } = req.body
  const { password, newPassword, newPasswordConfirm } = req.body

  // validate current password if updating own account
  if (targetId === user.userId && !ctx.user.isGuest) {
    if (!password) {
      ctx.throw(422, 'Current password is required')
    }

    if (!(await crypto.compare(password, user.password))) {
      ctx.throw(401, 'Incorrect current password')
    }
  }

  // validated
  const fields = new Map()

  // changing username?
  if (username && !ctx.user.isGuest) {
    username = username.trim()

    if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
      ctx.throw(400, `Username or email must have ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters`)
    }

    // check for duplicate
    if (User.getByUsername(username)) {
      ctx.throw(409, 'Username or email is not available')
    }

    fields.set('username', username)
  }

  // changing display name?
  if (name) {
    name = name.trim()

    if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
      ctx.throw(400, `Display name must have ${NAME_MIN_LENGTH}-${NAME_MAX_LENGTH} characters`)
    }

    fields.set('name', name)
  }

  // changing password?
  if (newPassword && !ctx.user.isGuest) {
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      ctx.throw(400, `Password must have at least ${PASSWORD_MIN_LENGTH} characters`)
    }

    if (newPassword !== newPasswordConfirm) {
      ctx.throw(422, 'New passwords do not match')
    }

    fields.set('password', await crypto.hash(newPassword))
  }

  // changing user image?
  if (req.files && req.files.image) {
    const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : req.files.image

    if (imageFile.size > IMG_MAX_LENGTH) {
      await deleteFile(imageFile.filepath)
      ctx.throw(413, `Image must not exceed ${Math.floor(IMG_MAX_LENGTH / 1024)}KB`)
    }

    fields.set('image', await readFile(imageFile.filepath))
    await deleteFile(imageFile.filepath)
  } else if (req.body.image === 'null') {
    fields.set('image', null)
  }

  // changing role?
  if (req.body.role) {
    // @todo since we're not ensuring there'd be at least one admin
    // remaining, changing one's own role is currently disallowed
    if (user.role !== 'admin' || targetId === user.userId) {
      ctx.throw(403)
    }

    fields.set('roleId', sql`(SELECT roleId FROM roles WHERE name = ${req.body.role})`)
  }

  fields.set('dateUpdated', Math.floor(Date.now() / 1000))

  const query = sql`
    UPDATE users
    SET ${sql.tuple(Array.from(fields.keys()).map(sql.column))} = ${sql.tuple(Array.from(fields.values()))}
    WHERE userId = ${targetId}
  `
  const res = db.run(String(query), query.parameters)

  if (!res.changes) {
    ctx.throw(404, `userId ${targetId} not found`)
  }

  // emit (potentially) updated queues to each room
  // @todo: only update rooms the user is in
  publishAllQueues(ctx.io)

  // updating another account? we're done
  if (targetId !== user.userId) {
    ctx.status = 200
    ctx.body = {}
    return
  }

  // updating own account: send updated token
  let updatedUser

  if (user.role !== 'guest') {
    try {
      updatedUser = await User.validate({
        username: username || user.username,
        password: newPassword || password,
      })
    } catch (err) {
      ctx.throw(401, err.message)
    }
  } else {
    updatedUser = {
      ...user,
      name: name || user.name,
    }
  }

  const userCtx = createUserContext(updatedUser, ctx.user.roomId || null)
  // @todo: updating an account should not extend the JWT expiry date.
  setUserCookie(ctx, userCtx)

  ctx.body = userCtx
})

// create account
router.post('/user', async (ctx) => {
  const req = ctx.request as unknown as RequestWithBody
  let image

  if (!ctx.user.isAdmin) {
    // already signed in?
    if (ctx.user.userId !== null) {
      ctx.throw(401, 'You are already signed in')
    }

    // only possible roles; further validated per-room below
    if (!['guest', 'standard'].includes(req.body.role)) {
      ctx.throw(401, 'Invalid role')
    }

    // new users must choose a room at the same time
    try {
      await Rooms.validate(
        req.body.roomId,
        req.body.roomPassword,
        { role: req.body.role },
      )
    } catch (err) {
      ctx.throw(401, err.message)
    }
  }

  if (req.files && req.files.image) {
    const imageFile = Array.isArray(req.files.image) ? req.files.image[0] : req.files.image

    if (imageFile.size > IMG_MAX_LENGTH) {
      await deleteFile(imageFile.filepath)
      ctx.throw(413, `Image must not exceed ${Math.floor(IMG_MAX_LENGTH / 1024)}KB`)
    }

    image = await readFile(imageFile.filepath)
    await deleteFile(imageFile.filepath)
  }

  // create user
  try {
    const userId = await User.create({ ...req.body, image } as any, req.body.role)

    // if admin creating another user, we're done
    if (ctx.user.isAdmin) {
      ctx.status = 200
      ctx.body = {}
      return
    }

    const user = User.getById(userId, true)

    if (!user) {
      throw new Error('User not found')
    }

    const userCtx = createUserContext(user, req.body.roomId || null)
    setUserCookie(ctx, userCtx)

    ctx.body = userCtx
  } catch (err) {
    ctx.throw(403, err.message)
  }
})

// get a user's image
router.get('/user/:userId/image', (ctx) => {
  const targetId = parseInt(ctx.params.userId, 10)

  if (ctx.user.userId !== targetId && !ctx.user.isAdmin) {
    // ensure target user has been in the same room
    if (!Rooms.hasUserBeenInRoom(ctx.user.roomId, targetId)) {
      ctx.throw(403)
    }
  }

  const user = User.getById(targetId)

  if (!user || !user.image) {
    ctx.throw(404)
    return
  }

  if (typeof ctx.query.v !== 'undefined') {
    // client can cache a versioned image forever
    ctx.set('Cache-Control', 'max-age=31536000') // 1 year
  }

  ctx.type = 'image/jpeg'
  ctx.body = Buffer.from(user.image)
})

router.use(sessionRouter.routes(), sessionRouter.allowedMethods())
router.use(adminRouter.routes(), adminRouter.allowedMethods())

export default router
