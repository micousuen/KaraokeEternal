import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import jsonWebToken from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import User from './User.js'
import { createUserContext, setUserCookie, validateUserContext } from './UserContext.js'

describe('user sessions', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-session-'))
    open({ file: path.join(tempDir, 'database.sqlite3'), ro: false })
    db.run(`INSERT INTO rooms (roomId, name, status, dateCreated, data) VALUES (1, 'Room', 'open', 1, '{}')`)
    db.run(`
      INSERT INTO users (userId, username, password, name, dateCreated, dateUpdated, roleId)
      VALUES (1, 'admin', 'hash', 'Admin', 1, 10, (SELECT roleId FROM roles WHERE name = 'admin'))
    `)
  })

  afterEach(() => {
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('issues an expiring cookie', () => {
    const set = vi.fn()
    const user = User.getById(1, true)
    setUserCookie({ cookies: { set }, jwtKey: 'secret', secure: true }, createUserContext(user, 1))

    const [, token, options] = set.mock.calls[0]
    const claims = jsonWebToken.verify(token, 'secret') as { exp: number, iat: number }
    expect(claims.exp).toBeGreaterThan(claims.iat)
    expect(options).toEqual(expect.objectContaining({ httpOnly: true, secure: true, maxAge: expect.any(Number) }))
  })

  it('rejects stale claims after an account role changes or is deleted', () => {
    const user = User.getById(1, true)
    const claims = { ...createUserContext(user, 1), exp: Math.floor(Date.now() / 1000) + 60 }
    expect(validateUserContext(claims)).toEqual(expect.objectContaining({ userId: 1, isAdmin: true }))

    db.run(`
      UPDATE users SET roleId = (SELECT roleId FROM roles WHERE name = 'standard'), dateUpdated = 11
      WHERE userId = 1
    `)
    expect(() => validateUserContext(claims)).toThrow('Account changed')

    db.run('DELETE FROM users WHERE userId = 1')
    expect(() => validateUserContext(claims)).toThrow('Account no longer exists')
  })

  it('selects only guest accounts older than the retention cutoff', () => {
    db.run(`
      INSERT INTO users (userId, username, password, name, dateCreated, dateUpdated, roleId)
      VALUES
        (2, 'old-guest', 'guest', 'Old', 100, 0, (SELECT roleId FROM roles WHERE name = 'guest')),
        (3, 'new-guest', 'guest', 'New', 101, 0, (SELECT roleId FROM roles WHERE name = 'guest')),
        (4, 'registered', 'hash', 'Registered', 1, 0, (SELECT roleId FROM roles WHERE name = 'standard'))
    `)

    expect(User.getExpiredGuestIds(100)).toEqual([2])
  })
})
