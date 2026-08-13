import crypto from '../lib/crypto.js'
import sql from 'sqlate'
import { db } from '../lib/Database.js'
import { ValidationError } from '../lib/Errors.js'
import { countRoomUsers } from '../User/PresenceRegistry.js'

const NAME_MIN_LENGTH = 1
const NAME_MAX_LENGTH = 50

// Remember which users have been seen in each room
const roomUsers: Map<number, Set<number>> = new Map()

class Rooms {
  /**
   * Get all rooms
   */
  static get (
    roomId: number | null | undefined = undefined,
    { status = [], includePassword = false }: { status?: string[], includePassword?: boolean } = {},
  ): { result: number[], entities: Record<number, any> } {
    const result = []
    const entities = {}
    const whereConditions = []
    let whereClause = sql``

    if (typeof roomId === 'number') {
      whereConditions.push(sql`roomId = ${roomId}`)
    }

    if (status && status.length > 0) {
      whereConditions.push(sql`status IN ${sql.tuple(status)}`)
    }

    if (whereConditions.length > 0) {
      whereClause = sql`WHERE ${whereConditions.reduce((acc, curr, index) => {
        if (index > 0) return sql`${acc} AND ${curr}`
        return curr
      })}`
    }

    const query = sql`
      SELECT *
      FROM rooms
      ${whereClause}
      ORDER BY dateCreated DESC
    `
    const res = db.all<{
      roomId: number
      name: string // assuming name exists
      status: string // assuming status exists
      data: string
      password?: string | null
      dateCreated: string | number
      prefs?: any
      hasPassword?: boolean
    }>(String(query), query.parameters)

    res.forEach((row) => {
      const data = JSON.parse(row.data)
      row.prefs = data.prefs ?? {}
      delete row.data

      row.hasPassword = !!row.password
      if (!includePassword) delete row.password

      row.dateCreated = parseInt(String(row.dateCreated), 10) // v1.0 schema used 'text' column

      result.push(row.roomId)
      entities[row.roomId] = row
    })

    return { result, entities }
  }

  static async set (roomId, room) {
    const { name } = room
    let prefs = room.prefs || {}
    let query

    if (!name || !name.trim() || name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
      throw new ValidationError(`Room name must have ${NAME_MIN_LENGTH}-${NAME_MAX_LENGTH} characters`)
    }

    if (typeof roomId === 'number') {
      const existing = Rooms.get(roomId, { status: [], includePassword: true }).entities[roomId]
      if (!existing) throw new ValidationError('Room not found')
      const existingSecret = existing.prefs?.qr?.password
      const joinSecret = existingSecret || crypto.randomToken()
      const passwordSql = existingSecret
        ? sql``
        : sql`password = ${await crypto.hash(joinSecret)},`
      prefs = {
        ...prefs,
        qr: {
          ...prefs.qr,
          isEnabled: true,
          isServerManaged: true,
          password: joinSecret,
        },
      }

      query = sql`
        UPDATE rooms
        SET name = ${name},
            ${passwordSql}
            status = 'open',
            data = json_set(data, '$.prefs', json(${JSON.stringify(prefs)}))
        WHERE roomId = ${roomId}
      `
    } else {
      const joinSecret = crypto.randomToken()
      const defaultRoles = db.all<{ roleId: number }>(
        'SELECT roleId FROM roles WHERE name IN (\'standard\', \'guest\')',
      )
      const rolePrefs = { ...prefs.roles }

      defaultRoles.forEach(({ roleId }) => {
        rolePrefs[roleId] = {
          allowNew: true,
          ...rolePrefs[roleId],
        }
      })

      prefs = {
        ...prefs,
        roles: rolePrefs,
        qr: { ...prefs.qr, isEnabled: true, isServerManaged: true, password: joinSecret },
      }
      query = sql`
        INSERT INTO rooms (name, password, status, dateCreated, data)
        VALUES (
          ${name},
          ${await crypto.hash(joinSecret)},
          'open',
          ${Math.floor(Date.now() / 1000)},
          json_set('{}', '$.prefs', json(${JSON.stringify(prefs)}))
        )
      `
    }

    return db.run(String(query), query.parameters)
  }

  /**
   * Validate a room against optional criteria
   */
  static async validate (
    roomId: number,
    password: string | undefined,
    {
      validatePassword = true,
      role,
    }: {
      validatePassword?: boolean
      role?: any
    } = {},
  ): Promise<boolean> {
    const res = Rooms.get(roomId, { includePassword: true })
    const room = res.entities[roomId]

    if (!room) {
      throw new Error('Room not found')
    }

    if (validatePassword && room.password) {
      if (!password) {
        throw new Error('Room password is required')
      }

      if (!(await crypto.compare(password, room.password))) {
        throw new Error('Incorrect room password')
      }

      if (crypto.isLegacy(room.password)) {
        const newHash = await crypto.hash(password)
        const query = sql`
          UPDATE rooms
          SET password = ${newHash}
          WHERE roomId = ${roomId}
        `
        db.run(String(query), query.parameters)
      }
    }

    if (role) {
      const query = sql`SELECT roleId FROM roles WHERE name = ${role}`
      const row = db.get<{ roleId: number }>(String(query), query.parameters)
      const roleId = row?.roleId

      if (!roleId) {
        throw new Error('Role not found')
      }

      if (!room.prefs?.roles?.[roleId]?.allowNew) {
        throw new Error(`New "${role}" accounts are not allowed in this room`)
      }
    }

    return true
  }

  /**
   * Count distinct authenticated users in a room. A user may have several
   * tabs or devices connected, but should only appear once in the room count.
   */
  static countActiveUsers (roomId: number): number {
    return countRoomUsers(roomId)
  }

  /**
   * Remember that a user has been in a room
   */
  static trackUser (roomId: number, userId: number) {
    if (!roomUsers.has(roomId)) {
      roomUsers.set(roomId, new Set())
    }

    roomUsers.get(roomId)!.add(userId)
  }

  /**
   * Check if a user has been in a room (since server start)
   */
  static hasUserBeenInRoom (roomId: number, userId: number): boolean {
    return roomUsers.get(roomId)?.has(userId) ?? false
  }
}

export default Rooms
