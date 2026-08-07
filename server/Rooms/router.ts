import KoaRouter from '@koa/router'
import jsonWebToken from 'jsonwebtoken'
import sql from 'sqlate'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import Rooms from '../Rooms/Rooms.js'
import { ValidationError } from '../lib/Errors.js'

interface RequestWithBody {
  body: Record<string, unknown>
}

const log = getLogger('Rooms')
const router = new KoaRouter({ prefix: '/api/rooms' })
const { sign: jwtSign } = jsonWebToken

const setAdminRoom = (ctx, roomId: number | null) => {
  const userCtx = {
    dateCreated: ctx.user.dateCreated,
    dateUpdated: ctx.user.dateUpdated,
    isAdmin: true,
    isGuest: false,
    name: ctx.user.name,
    roomId,
    userId: ctx.user.userId,
    username: ctx.user.username,
  }
  const token = jwtSign(userCtx, ctx.jwtKey)

  ctx.cookies.set('keToken', token, {
    httpOnly: true,
    sameSite: 'lax',
  })
  ctx.body = userCtx
}

import { ROOM_PREFS_PUSH } from '../../shared/actionTypes.js'

// list rooms
router.get(['/', '/:roomId'], (ctx) => {
  const roomId = ctx.params.roomId ? parseInt(ctx.params.roomId, 10) : undefined
  const res = Rooms.get(roomId)

  res.result.forEach((roomId) => {
    if (ctx.user.isAdmin) {
      const room = ctx.io.sockets.adapter.rooms.get(Rooms.prefix(roomId))
      res.entities[roomId].numUsers = room ? room.size : 0
    } else {
      // only pass the 'roles' prefs key
      res.entities[roomId].prefs = res.entities[roomId].prefs?.roles ? { roles: res.entities[roomId].prefs.roles } : {}
    }
  })

  ctx.body = res
})

// create room
router.post('/', async (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  try {
    const res = await Rooms.set(undefined, (ctx.request as unknown as RequestWithBody).body)
    log.verbose('%s created a room (roomId: %s)', ctx.user.name, res.lastID)
  } catch (err) {
    if (err instanceof ValidationError) ctx.throw(422, err.message)
    throw err
  }

  // send updated room list
  ctx.body = Rooms.get(null, { status: [] })
})

// switch an administrator's session into a room
router.post('/:roomId/join', async (ctx) => {
  if (!ctx.user.isAdmin || typeof ctx.user.userId !== 'number') {
    ctx.throw(401)
  }

  const roomId = parseInt(ctx.params.roomId, 10)
  const room = Rooms.get(roomId, { status: [] }).entities[roomId]

  if (!room) ctx.throw(404, 'Room not found')

  setAdminRoom(ctx, roomId)
})

// return an administrator to room-independent account management
router.post('/leave', (ctx) => {
  if (!ctx.user.isAdmin || typeof ctx.user.userId !== 'number') {
    ctx.throw(401)
  }

  setAdminRoom(ctx, null)
})

// update room
router.put('/:roomId', async (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  const roomId = parseInt(ctx.params.roomId, 10)

  try {
    await Rooms.set(roomId, (ctx.request as unknown as RequestWithBody).body)
  } catch (err) {
    if (err instanceof ValidationError) ctx.throw(422, err.message)
    throw err
  }

  log.verbose('%s updated a room (roomId: %s)', ctx.user.name, roomId)

  const sockets = await ctx.io.in(Rooms.prefix(roomId)).fetchSockets()

  for (const s of sockets) {
    if (s?.user.isAdmin) {
      ctx.io.to(s.id).emit('action', {
        type: ROOM_PREFS_PUSH,
        payload: Rooms.get(roomId),
      })
    }
  }

  // send updated room list
  ctx.body = Rooms.get(null, { status: [] })
})

// remove room
router.delete('/:roomId', (ctx) => {
  if (!ctx.user.isAdmin) {
    ctx.throw(401)
  }

  const roomId = parseInt(ctx.params.roomId, 10)

  if (typeof roomId !== 'number') {
    ctx.throw(422, 'Invalid roomId')
  }

  // remove room's queue first
  const queueQuery = sql`
    DELETE FROM queue
    WHERE roomId = ${roomId}
  `
  db.run(String(queueQuery), queueQuery.parameters)

  // remove room
  const roomQuery = sql`
    DELETE FROM rooms
    WHERE roomId = ${roomId}
  `
  db.run(String(roomQuery), roomQuery.parameters)

  log.verbose('%s deleted roomId %s', ctx.user.name, roomId)

  // send updated room list
  ctx.body = Rooms.get(null, { status: [] })
})

export default router
