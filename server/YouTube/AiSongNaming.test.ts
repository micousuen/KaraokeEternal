import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { close, db, open } from '../lib/Database.js'
import Prefs from '../Prefs/Prefs.js'
import { isManagedDownloadSong, managedDownloadInput, renameManagedDownloadWithAi } from './AiSongNaming.js'

afterEach(() => vi.unstubAllGlobals())

describe('managedDownloadInput', () => {
  it('strips the managed download wrapper from a filename', () => {
    expect(managedDownloadInput('/media/downloads/YouTube-Queen-We Will Rock You-YouTube [dQw4w9WgXcQ].mp4'))
      .toBe('Queen-We Will Rock You')
  })

  it('passes already-renamed filenames through', () => {
    expect(managedDownloadInput('/media/library/Queen-We Will Rock You.mp4'))
      .toBe('Queen-We Will Rock You')
  })
})

describe('renameManagedDownloadWithAi', () => {
  let tempDir: string
  const oldName = 'YouTube-Queen We Will Rock You karaoke-YouTube [12345678901].mp4'

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-ainaming-'))
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
    Prefs.setDeepSeekApiKey('sk_test')
  })

  afterEach(() => {
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('renames a managed download from its filename', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"artist":"Queen","title":"We Will Rock You"}' } }],
    }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await renameManagedDownloadWithAi(1)
    expect(result).toEqual({ songId: 1, artist: 'Queen', title: 'We Will Rock You' })
    expect(isManagedDownloadSong(1)).toBe(true)
    expect(fs.existsSync(path.join(tempDir, oldName))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, 'Queen-We Will Rock You.mp4'))).toBe(true)
    expect(db.get('SELECT relPath FROM media WHERE mediaId = 1'))
      .toEqual({ relPath: 'Queen-We Will Rock You.mp4' })
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toHaveProperty('Authorization', 'Bearer sk_test')
  })

  it('refuses songs that contain media from regular library folders', async () => {
    db.run('INSERT INTO paths (pathId, path, priority, data) VALUES (2, ?, 1, ?)', [
      tempDir + path.sep + 'library',
      JSON.stringify({}),
    ])
    db.run(`
      INSERT INTO media (mediaId, songId, pathId, relPath, duration, isManagedDownload)
      VALUES (2, 1, 2, 'Queen-We Will Rock You.mp4', 60, 0)
    `)

    await expect(renameManagedDownloadWithAi(1)).rejects.toThrow('Only YouTube downloads')
    expect(isManagedDownloadSong(1)).toBe(false)
  })

  it('requires a configured API key', async () => {
    Prefs.setDeepSeekApiKey(' ')

    await expect(renameManagedDownloadWithAi(1)).rejects.toThrow('Configure a DeepSeek API key')
  })
})
