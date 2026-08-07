import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Queue from './Queue.js'
import { close, db, open } from '../lib/Database.js'

describe('Queue linked-list integrity', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-queue-'))
    open({ file: path.join(tempDir, 'database.sqlite3'), ro: false })
    db.exec('PRAGMA foreign_keys = OFF')
  })

  afterEach(() => {
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const insertQueue = (rows: Array<[number, number | null]>) => {
    for (const [queueId, prevQueueId] of rows) {
      db.run(
        'INSERT INTO queue (queueId, roomId, songId, userId, prevQueueId) VALUES (?, 1, ?, 1, ?)',
        [queueId, queueId, prevQueueId],
      )
    }
  }

  const links = () => db.all<{ queueId: number, prevQueueId: number | null }>(
    'SELECT queueId, prevQueueId FROM queue WHERE roomId = 1 ORDER BY queueId',
  )

  it('moves the root after another item without creating duplicate children', () => {
    insertQueue([[1, null], [2, 1], [3, 2]])

    Queue.move({ roomId: 1, queueId: 1, prevQueueId: 3 })

    expect(links()).toEqual([
      { queueId: 1, prevQueueId: 3 },
      { queueId: 2, prevQueueId: null },
      { queueId: 3, prevQueueId: 2 },
    ])
  })

  it('repairs duplicate children instead of crashing while reading', () => {
    insertQueue([[1, null], [2, 1], [3, 1]])

    expect(() => Queue.get(1)).not.toThrow()
    expect(links()).toEqual([
      { queueId: 1, prevQueueId: null },
      { queueId: 2, prevQueueId: 1 },
      { queueId: 3, prevQueueId: 2 },
    ])
  })
})
