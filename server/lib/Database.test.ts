import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseWrapper } from './Database.js'

describe('DatabaseWrapper read-only mode', () => {
  let tempDir: string | undefined

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('opens SQLite in actual read-only mode', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-db-readonly-'))
    const filename = path.join(tempDir, 'database.sqlite3')
    const writer = new DatabaseWrapper(filename)
    writer.exec('CREATE TABLE example (value TEXT)')
    writer.run('INSERT INTO example (value) VALUES (?)', ['saved'])
    writer.close()

    const reader = new DatabaseWrapper(filename, true)
    expect(reader.get('SELECT value FROM example')).toEqual({ value: 'saved' })
    expect(() => reader.run('INSERT INTO example (value) VALUES (?)', ['changed']))
      .toThrow(/read.?only/i)
    reader.close()
  })
})
