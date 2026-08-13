import jsonWebToken from 'jsonwebtoken'
import Rooms from '../Rooms/Rooms.js'
import User from './User.js'

const sessionMaxAgeSeconds = positiveInteger(process.env.KES_SESSION_MAX_AGE_SECONDS, 7 * 24 * 60 * 60)

export interface UserContext {
  dateCreated: number
  dateUpdated: number | null
  isAdmin: boolean
  isGuest: boolean
  name: string
  roomId: number | null
  userId: number
  username?: string
  exp?: number
}

export function createUserContext (user, roomId) {
  return {
    dateCreated: user.dateCreated,
    dateUpdated: user.dateUpdated,
    isAdmin: user.role === 'admin',
    isGuest: user.role === 'guest',
    name: user.name,
    roomId: parseInt(roomId, 10) || null,
    userId: user.userId,
    username: user.username,
  }
}

export function setUserCookie (ctx, userContext): void {
  ctx.cookies.set('keToken', jsonWebToken.sign(userContext, ctx.jwtKey, {
    expiresIn: sessionMaxAgeSeconds,
  }), {
    httpOnly: true,
    maxAge: sessionMaxAgeSeconds * 1000,
    sameSite: 'lax',
    secure: ctx.secure,
  })
}

/**
 * Reconcile signed claims with the database. JWTs prove who issued a claim;
 * this check makes account deletion, password/role changes, and room removal
 * revoke that claim immediately instead of waiting for token expiry.
 */
export function validateUserContext (claims: unknown): UserContext {
  if (!isUserContext(claims)) throw new Error('Invalid session')
  const user = User.getById(claims.userId, true)
  if (!user) throw new Error('Account no longer exists')

  const current = createUserContext(user, claims.roomId) as UserContext
  if (current.dateUpdated !== claims.dateUpdated
    || current.isAdmin !== claims.isAdmin
    || current.isGuest !== claims.isGuest) {
    throw new Error('Account changed; sign in again')
  }
  if (typeof current.roomId === 'number'
    && !Rooms.get(current.roomId, { status: [] }).entities[current.roomId]) {
    throw new Error('Room no longer exists')
  }
  if (!current.isAdmin && typeof current.roomId !== 'number') throw new Error('Room session required')
  return current
}

function isUserContext (value: unknown): value is UserContext {
  if (typeof value !== 'object' || value === null) return false
  const claims = value as Partial<UserContext>
  return Number.isInteger(claims.userId)
    && (claims.roomId === null || Number.isInteger(claims.roomId))
    && typeof claims.isAdmin === 'boolean'
    && typeof claims.isGuest === 'boolean'
    && Number.isInteger(claims.exp)
}

function positiveInteger (value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
