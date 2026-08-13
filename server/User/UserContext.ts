import jsonWebToken from 'jsonwebtoken'

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
  ctx.cookies.set('keToken', jsonWebToken.sign(userContext, ctx.jwtKey), {
    httpOnly: true,
    sameSite: 'lax',
  })
}
