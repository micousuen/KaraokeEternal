import { db } from '../lib/Database.js'
import sql from 'sqlate'
import { QueueItem } from '../../shared/types.js'
import getLogger from '../lib/Log.js'

const log = getLogger('Queue')

class Queue {
  /**
   * Add a songId to a room's queue
   */
  static add ({ roomId, songId, userId }: { roomId: number, songId: number, userId: number }): void {
    const fields = new Map()
    fields.set('roomId', roomId)
    fields.set('songId', songId)
    fields.set('userId', userId)
    fields.set('prevQueueId', sql`(
      SELECT queueId
      FROM queue
      WHERE roomId = ${roomId} AND queueId NOT IN (
        SELECT prevQueueId
        FROM queue
        WHERE prevQueueId IS NOT NULL
      )
    )`)

    const query = sql`
      INSERT INTO queue ${sql.tuple(Array.from(fields.keys()).map(sql.column))}
      VALUES ${sql.tuple(Array.from(fields.values()))}
    `
    const res = db.run(String(query), query.parameters)

    if (res.changes !== 1) {
      throw new Error('Could not add song to queue')
    }
  }

  /**
   * Get queued items for a given room
   */
  static get (roomId: number): { result: number[], entities: Record<number, QueueItem> } {
    const entities: Record<number, QueueItem> = {}
    const pathData = new Map()
    const storedOrder = this.getStoredOrder(roomId, true)

    const query = sql`
      SELECT queueId, songId, userId, prevQueueId, queue.isPlayed,
        media.mediaId, media.rgTrackGain, media.rgTrackPeak,
        users.name AS userDisplayName, users.dateUpdated AS userDateUpdated,
        paths.pathId, paths.data AS pathData,
        MAX(isPreferred) AS isPreferred
      FROM queue
        INNER JOIN users USING(userId)
        INNER JOIN media USING(songId)
        INNER JOIN paths USING(pathId)
      WHERE roomId = ${roomId}
      GROUP BY queueId
      ORDER BY queueId, paths.priority ASC
    `
    const rows = db.all<{
      queueId: number
      songId: number
      userId: number
      prevQueueId: number | null
      mediaId: number
      rgTrackGain: number
      rgTrackPeak: number
      userDisplayName: string
      userDateUpdated: number
      pathId: number
      pathData: string
      isPreferred: number
      isPlayed: number
    }>(String(query), query.parameters)

    for (const row of rows) {
      if (!pathData.has(row.pathId)) {
        pathData.set(row.pathId, JSON.parse(row.pathData))
      }

      const pathPrefs = pathData.get(row.pathId)?.prefs

      entities[row.queueId] = {
        queueId: row.queueId,
        songId: row.songId,
        userId: row.userId,
        prevQueueId: row.prevQueueId,
        mediaId: row.mediaId,
        rgTrackGain: row.rgTrackGain,
        rgTrackPeak: row.rgTrackPeak,
        userDateUpdated: row.userDateUpdated,
        userDisplayName: row.userDisplayName,
        isPlayed: !!row.isPlayed,
        isVideoKeyingEnabled: !!pathPrefs?.isVideoKeyingEnabled,
      }
    }

    // A queue entry can temporarily lack usable media while the library is
    // being rescanned. Keep its database link but omit it from the wire payload.
    const result = storedOrder.filter(queueId => entities[queueId])

    return { result, entities }
  }

  /** Read a room's linked list, repairing duplicate/orphan/cyclic links. */
  private static getStoredOrder (roomId: number, repair: boolean): number[] {
    const rows = db.all<{ queueId: number, prevQueueId: number | null }>(
      'SELECT queueId, prevQueueId FROM queue WHERE roomId = ? ORDER BY queueId',
      [roomId],
    )
    if (rows.length === 0) return []

    const ids = new Set(rows.map(row => row.queueId))
    const children = new Map<number, number[]>()
    const roots: number[] = []
    let isValid = true

    for (const row of rows) {
      if (row.prevQueueId === null || !ids.has(row.prevQueueId)) {
        roots.push(row.queueId)
        if (row.prevQueueId !== null) isValid = false
      } else {
        const siblings = children.get(row.prevQueueId) || []
        siblings.push(row.queueId)
        children.set(row.prevQueueId, siblings)
        if (siblings.length > 1) isValid = false
      }
    }
    if (roots.length !== 1) isValid = false

    const order: number[] = []
    const visited = new Set<number>()
    const visit = (queueId: number) => {
      if (visited.has(queueId)) {
        isValid = false
        return
      }
      visited.add(queueId)
      order.push(queueId)
      for (const child of (children.get(queueId) || []).sort((a, b) => a - b)) visit(child)
    }

    for (const root of roots.sort((a, b) => a - b)) visit(root)
    for (const row of rows) {
      if (!visited.has(row.queueId)) {
        isValid = false
        visit(row.queueId)
      }
    }

    if ((!isValid || order.length !== rows.length) && repair) {
      log.warn('Repairing malformed queue links in room %s', roomId)
      this.setOrder(roomId, order)
    }

    return order
  }

  /** Persist newly completed queue entries for the room's Played view. */
  static markPlayed (roomId: number, queueIds: number[]): boolean {
    const ids = [...new Set(queueIds.filter(Number.isInteger))]
    if (ids.length === 0) return false

    const query = sql`
      UPDATE queue
      SET isPlayed = 1
      WHERE roomId = ${roomId}
        AND isPlayed = 0
        AND queueId IN ${sql.tuple(ids)}
    `
    return db.run(String(query), query.parameters).changes > 0
  }

  /**
   * Move a queue item
   */
  static move ({ prevQueueId, queueId, roomId }: { prevQueueId: number | null, queueId: number, roomId: number }): void {
    if (queueId === prevQueueId) {
      throw new Error('Invalid prevQueueId')
    }

    if (prevQueueId === -1) prevQueueId = null

    const order = this.getStoredOrder(roomId, true)
    const sourceIndex = order.indexOf(queueId)
    if (sourceIndex === -1) throw new Error('Queue item is not in this room')

    order.splice(sourceIndex, 1)
    const destinationIndex = prevQueueId === null ? -1 : order.indexOf(prevQueueId)
    if (prevQueueId !== null && destinationIndex === -1) {
      throw new Error('Queue destination is not in this room')
    }

    order.splice(destinationIndex + 1, 0, queueId)
    this.setOrder(roomId, order)
  }

  /** Replace the complete linked-list order for one room atomically. */
  static setOrder (roomId: number, queueIds: number[]): void {
    if (!Array.isArray(queueIds) || queueIds.some(id => !Number.isInteger(id))) {
      throw new Error('Invalid queue order')
    }

    const current = db.all<{ queueId: number }>('SELECT queueId FROM queue WHERE roomId = ?', [roomId])
      .map(row => row.queueId)
      .sort((a, b) => a - b)
    const requested = [...new Set(queueIds)].sort((a, b) => a - b)

    if (requested.length !== queueIds.length
      || requested.length !== current.length
      || requested.some((id, index) => id !== current[index])) {
      throw new Error('Queue order must contain every item in this room exactly once')
    }

    db.exec('BEGIN IMMEDIATE')
    db.exec('PRAGMA defer_foreign_keys = ON')

    try {
      db.run('UPDATE queue SET prevQueueId = NULL WHERE roomId = ?', [roomId])
      for (let i = 1; i < queueIds.length; i++) {
        db.run('UPDATE queue SET prevQueueId = ? WHERE queueId = ? AND roomId = ?', [queueIds[i - 1], queueIds[i], roomId])
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  /**
   * Delete a queue item
   */
  static remove (queueId: number): void {
    const row = db.get<{ roomId: number }>('SELECT roomId FROM queue WHERE queueId = ?', [queueId])
    if (!row) throw new Error(`Could not remove queueId: ${queueId}`)
    this.getStoredOrder(row.roomId, true)

    db.exec('BEGIN IMMEDIATE')
    db.exec('PRAGMA defer_foreign_keys = ON') // v0.9 betas didn't have prevQueueId DEFERRABLE

    try {
      const deleteQuery = sql`
        DELETE FROM queue
        WHERE queueId = ${queueId}
        RETURNING prevQueueId
      `
      const deletedRow = db.get<{ prevQueueId: number | null }>(String(deleteQuery), deleteQuery.parameters)

      if (deletedRow === undefined) {
        throw new Error(`Could not remove queueId: ${queueId}`)
      }

      // close the gap
      const updateQuery = sql`
        UPDATE queue
        SET prevQueueId = ${deletedRow.prevQueueId}
        WHERE prevQueueId = ${queueId}
      `
      db.run(String(updateQuery), updateQuery.parameters)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  /**
   * Check if user owns queue item(s)
   */
  static isOwner (userId: number, queueId: number | number[]): boolean {
    const ids = Array.isArray(queueId) ? queueId : [queueId]
    if (ids.length === 0) return false

    const query = sql`
      SELECT COUNT(*) AS count
      FROM queue
      WHERE userId = ${userId} AND queueId IN ${sql.tuple(ids)}
    `
    const res = db.get<{ count: number }>(String(query), query.parameters)
    return res.count === ids.length
  }

  static isInRoom (queueId: number, roomId: number): boolean {
    const row = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM queue WHERE queueId = ? AND roomId = ?',
      [queueId, roomId],
    )
    return row.count === 1
  }
}

export default Queue
