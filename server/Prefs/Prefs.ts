import path from 'path'
import sql from 'sqlate'
import crypto from 'crypto'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'

const log = getLogger('Prefs')
const ELEVENLABS_API_KEY = 'elevenLabsApiKey'
const DEEPSEEK_API_KEY = 'deepSeekApiKey'
const PRIVATE_KEYS = new Set(['jwtKey', ELEVENLABS_API_KEY, DEEPSEEK_API_KEY])

class Prefs {
  /**
   * Get all global preferences (includes media paths; excludes private credentials)
   */
  static get () {
    const prefs = {
      isElevenLabsApiKeyConfigured: false,
      isDeepSeekApiKeyConfigured: false,
      paths: { result: [], entities: {} },
      roles: { result: [], entities: {} },
    }

    {
      const query = sql`
        SELECT * FROM prefs
        WHERE key NOT IN ('jwtKey', 'elevenLabsApiKey', 'deepSeekApiKey')
      `
      const rows = db.all<{ key: string, data: string }>(String(query), query.parameters)

      // json-decode key/val pairs
      rows.forEach((row) => {
        prefs[row.key] = JSON.parse(row.data)
      })
    }

    prefs.isElevenLabsApiKeyConfigured = !!Prefs.getElevenLabsApiKey()
    prefs.isDeepSeekApiKeyConfigured = !!Prefs.getDeepSeekApiKey()

    // include roles
    {
      const query = sql`
        SELECT roleId, name
        FROM roles
      `
      const rows = db.all<{ roleId: number, name: string }>(String(query), query.parameters)

      for (const row of rows) {
        prefs.roles.entities[row.roleId] = row
        prefs.roles.result.push(row.roleId)
      }
    }

    // include media paths
    {
      const query = sql`
        SELECT * FROM paths
        ORDER BY priority
      `
      const rows = db.all<{ pathId: number, path: string, priority: number, data: string }>(String(query), query.parameters)

      for (const row of rows) {
        const data = JSON.parse(row.data)
        delete row.data
        prefs.paths.entities[row.pathId] = { ...row, ...data }
        prefs.paths.result.push(row.pathId)
      }
    }

    return prefs
  }

  /**
   * Set a global preference
   * @param key - the preference key
   * @param data - the value to be JSON-encoded
   * @return Success/fail boolean
   */
  static set (key: string, data: any): boolean {
    if (PRIVATE_KEYS.has(key)) throw new Error('Private preferences must use their dedicated setter')
    const query = sql`
      REPLACE INTO prefs (key, data)
      VALUES (${key}, ${JSON.stringify(data)})
    `
    const res = db.run(String(query), query.parameters)
    return res.changes === 1
  }

  /** Read the ElevenLabs credential without exposing it through get(). */
  static getElevenLabsApiKey (): string | undefined {
    const query = sql`
      SELECT data FROM prefs
      WHERE key = ${ELEVENLABS_API_KEY}
    `
    const row = db.get<{ data: string }>(String(query), query.parameters)
    if (!row) return undefined
    try {
      const value = JSON.parse(row.data)
      return typeof value === 'string' && value.trim() ? value.trim() : undefined
    } catch {
      return undefined
    }
  }

  /** Store or clear the database-backed ElevenLabs credential. */
  static setElevenLabsApiKey (apiKey: string): boolean {
    const value = apiKey.trim()
    if (value.length > 512) throw new Error('ElevenLabs API key is too long')
    if (!value) {
      return db.run('DELETE FROM prefs WHERE key = ?', [ELEVENLABS_API_KEY]).changes <= 1
    }
    const query = sql`
      REPLACE INTO prefs (key, data)
      VALUES (${ELEVENLABS_API_KEY}, ${JSON.stringify(value)})
    `
    return db.run(String(query), query.parameters).changes === 1
  }

  /** Read the DeepSeek credential without exposing it through get(). */
  static getDeepSeekApiKey (): string | undefined {
    const query = sql`
      SELECT data FROM prefs
      WHERE key = ${DEEPSEEK_API_KEY}
    `
    const row = db.get<{ data: string }>(String(query), query.parameters)
    if (!row) return undefined
    try {
      const value = JSON.parse(row.data)
      return typeof value === 'string' && value.trim() ? value.trim() : undefined
    } catch {
      return undefined
    }
  }

  /** Store or clear the database-backed DeepSeek credential. */
  static setDeepSeekApiKey (apiKey: string): boolean {
    const value = apiKey.trim()
    if (value.length > 512) throw new Error('DeepSeek API key is too long')
    if (!value) {
      return db.run('DELETE FROM prefs WHERE key = ?', [DEEPSEEK_API_KEY]).changes <= 1
    }
    const query = sql`
      REPLACE INTO prefs (key, data)
      VALUES (${DEEPSEEK_API_KEY}, ${JSON.stringify(value)})
    `
    return db.run(String(query), query.parameters).changes === 1
  }

  /**
   * Add media path
   * @param dir - an absolute path
   * @param data - the object to be JSON-encoded
   * @return the newly-added path's pathId
   */
  static addPath (dir: string, data?: object): number {
    const prefs = Prefs.get()
    const { result, entities } = prefs.paths

    // is it a subfolder of an already-added folder?
    if (result.some(pathId => (dir + path.sep).indexOf(entities[pathId].path + path.sep) === 0)) {
      throw new Error('Folder has already been added')
    }

    const fields = new Map()
    fields.set('path', dir)
    // priority defaults to one higher than current highest
    fields.set('priority', result.length ? entities[result[result.length - 1]].priority + 1 : 0)
    if (data) fields.set('data', JSON.stringify(data))

    const query = sql`
      INSERT INTO paths ${sql.tuple(Array.from(fields.keys()).map(sql.column))}
      VALUES ${sql.tuple(Array.from(fields.values()))}
    `
    const res = db.run(String(query), query.parameters)

    if (!Number.isInteger(res.lastID)) {
      throw new Error('invalid lastID from path insert')
    }

    return res.lastID
  }

  /**
   * Remove a media path
   */
  static removePath (pathId: number): void {
    const query = sql`
      DELETE FROM paths
      WHERE pathId = ${pathId}
    `
    db.run(String(query), query.parameters)
  }

  /**
   * Set media path priorities
   */
  static setPathPriority (pathIds: number[]): void {
    if (!Array.isArray(pathIds)) {
      throw new Error('pathIds must be an array')
    }

    const query = sql`
      UPDATE paths
        SET priority = CASE pathId
          ${sql.concat(pathIds.map((pathId, i) => sql`WHEN ${pathId} THEN ${i} `))}
        END
      WHERE pathId IN ${sql.tuple(pathIds)}
      `
    db.run(String(query), query.parameters)
  }

  /**
   * Set a path's JSON data
   * @param keyPrefix - key prefix; e.g. `prefs.`
   * @param data - key:value pair to set
   * @todo Currently only supports one key:value pair at a time
   */
  static setPathData (pathId: number, keyPrefix: string = '', data: object): void {
    const keys = Object.keys(data).map(key => `$.${keyPrefix}${key}`)
    const values = Object.values(data)

    const query = sql`
      UPDATE paths
      SET data = json_set(data, ${keys[0]}, json(${JSON.stringify(values[0])}))
      WHERE pathId = ${pathId}
    `
    db.run(String(query), query.parameters)
  }

  /**
   * Get JWT secret key from db
   * @return the current or newly-generated key
   */
  static getJwtKey (forceRotate: boolean = false): string {
    if (forceRotate) return this.rotateJwtKey()

    const query = sql`
      SELECT * FROM prefs
      WHERE key = 'jwtKey'
    `
    const row = db.get<{ key: string, data: string }>(String(query), query.parameters)

    if (row && row.data) {
      const jwtKey = JSON.parse(row.data)
      if (jwtKey.length === 64) return jwtKey
    }

    return this.rotateJwtKey()
  }

  /**
   * Create or rotate JWT secret key
   */
  static rotateJwtKey (): string {
    const jwtKey = crypto.randomBytes(48).toString('base64') // 64 char
    log.info('Rotating JWT secret key (length=%s)', jwtKey.length)

    const query = sql`
      REPLACE INTO prefs (key, data)
      VALUES ('jwtKey', ${JSON.stringify(jwtKey)})
    `
    const res = db.run(String(query), query.parameters)

    if (!res.changes) {
      throw new Error('Unable to update JWT secret key')
    }

    return jwtKey
  }
}

export default Prefs
