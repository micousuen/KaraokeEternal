import jsonWebToken from 'jsonwebtoken'
import { describe, expect, it, vi } from 'vitest'
import { setAdminRoom } from './router.js'

describe('admin room session', () => {
  it('preserves an expiring authenticated session when joining a room', () => {
    const set = vi.fn()
    const ctx = {
      cookies: { set },
      jwtKey: 'secret',
      secure: true,
      user: {
        dateCreated: 1,
        dateUpdated: 2,
        isAdmin: true,
        isGuest: false,
        name: 'Admin',
        roomId: null,
        userId: 3,
        username: 'admin',
      },
    } as any

    setAdminRoom(ctx, 7)

    const [, token, options] = set.mock.calls[0]
    const claims = jsonWebToken.verify(token, 'secret') as { exp: number, iat: number, roomId: number }
    expect(claims.roomId).toBe(7)
    expect(claims.exp).toBeGreaterThan(claims.iat)
    expect(options).toEqual(expect.objectContaining({
      httpOnly: true,
      maxAge: expect.any(Number),
      sameSite: 'lax',
      secure: true,
    }))
    expect(ctx.body).toEqual(expect.objectContaining({ roomId: 7, userId: 3 }))
  })
})
