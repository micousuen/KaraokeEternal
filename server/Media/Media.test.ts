import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Media from './Media.js'
import { close, db, open } from '../lib/Database.js'

describe('song rename', () => {
  let tempDir: string
  const oldName = 'YouTube-Old title-YouTube [12345678901].mp4'

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-rename-'))
    open({ file: path.join(tempDir, 'database.sqlite3'), ro: false })
    db.exec('PRAGMA foreign_keys = OFF')
    db.run('INSERT INTO artists (artistId, name, nameNorm) VALUES (1, ?, ?)', ['YouTube', 'YouTube'])
    db.run('INSERT INTO songs (songId, artistId, title, titleNorm) VALUES (1, 1, ?, ?)', ['Old title', 'Old title'])
    db.run('INSERT INTO paths (pathId, path, priority, data) VALUES (1, ?, 0, ?)', [
      tempDir,
      JSON.stringify({ isManagedDownloadPath: true }),
    ])
    db.run(`
      INSERT INTO media (mediaId, songId, pathId, relPath, duration, isManagedDownload)
      VALUES (1, 1, 1, ?, 60, 1)
    `, [oldName])
    fs.writeFileSync(path.join(tempDir, oldName), 'video')
  })

  afterEach(() => {
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('renames the file and database records', async () => {
    await Media.renameSong(1, 'New title', 'New author')

    expect(fs.existsSync(path.join(tempDir, oldName))).toBe(false)
    expect(fs.readFileSync(path.join(tempDir, 'New author-New title.mp4'), 'utf8')).toBe('video')
    expect(db.get('SELECT relPath FROM media WHERE mediaId = 1')).toEqual({ relPath: 'New author-New title.mp4' })
    expect(db.get('SELECT title, titleNorm, artistId FROM songs WHERE songId = 1')).toEqual({
      title: 'New title',
      titleNorm: 'New title',
      artistId: 2,
    })
    expect(db.get('SELECT name FROM artists WHERE artistId = 2')).toEqual({ name: 'New author' })
  })

  it('stores boolean media flags as SQLite integers', () => {
    db.run('INSERT INTO songs (songId, artistId, title, titleNorm) VALUES (2, 1, ?, ?)', ['Boolean flag', 'Boolean flag'])

    const mediaId = Media.add({
      songId: 2,
      pathId: 1,
      relPath: 'boolean-flag.mp4',
      duration: 60,
      isManagedDownload: true,
    })

    expect(db.get('SELECT isManagedDownload FROM media WHERE mediaId = ?', [mediaId]))
      .toEqual({ isManagedDownload: 1 })
  })

  it('returns all media when the search filter is empty', () => {
    db.run('INSERT INTO songs (songId, artistId, title, titleNorm) VALUES (2, 1, ?, ?)', ['Second song', 'Second song'])
    db.run(`
      INSERT INTO media (mediaId, songId, pathId, relPath, duration)
      VALUES (2, 2, 1, 'second.mp4', 60)
    `)

    expect(Media.search({}).result).toEqual([1, 2])
  })

  it('rejects collisions without changing the file or database', async () => {
    fs.writeFileSync(path.join(tempDir, 'YouTube-Existing.mp4'), 'other')

    await expect(Media.renameSong(1, 'Existing', 'YouTube')).rejects.toThrow('already exists')
    expect(fs.existsSync(path.join(tempDir, oldName))).toBe(true)
    expect(db.get('SELECT relPath FROM media WHERE mediaId = 1')).toEqual({ relPath: oldName })
    expect(db.get('SELECT title FROM songs WHERE songId = 1')).toEqual({ title: 'Old title' })
  })

  it('merges into an existing author and song', async () => {
    db.run('INSERT INTO artists (artistId, name, nameNorm) VALUES (2, ?, ?)', ['Known author', 'Known author'])
    db.run('INSERT INTO songs (songId, artistId, title, titleNorm) VALUES (2, 2, ?, ?)', ['Known title', 'Known title'])
    db.run('INSERT INTO queue (queueId, roomId, songId, userId) VALUES (1, 1, 1, 1)')

    const result = await Media.renameSong(1, 'Known title', 'Known author')

    expect(result).toEqual({ songId: 2 })
    expect(db.get('SELECT songId, relPath FROM media WHERE mediaId = 1')).toEqual({
      songId: 2,
      relPath: 'Known author-Known title.mp4',
    })
    expect(db.get('SELECT songId FROM queue WHERE queueId = 1')).toEqual({ songId: 2 })
    expect(db.get('SELECT songId FROM songs WHERE songId = 1')).toBeUndefined()
  })
})
