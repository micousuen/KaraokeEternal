import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import { buildLibrarySnapshot } from '../Library/LibrarySnapshot.js'
import { getMediaQueueReadiness, getSongQueueReadiness } from './MediaQueueReadiness.js'

describe('YouTube media queue readiness', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-readiness-'))
    open({ file: path.join(tempDir, 'database.sqlite3'), ro: false })
    db.exec('PRAGMA foreign_keys = OFF')
    db.run('INSERT INTO artists (artistId, name, nameNorm) VALUES (1, ?, ?)', ['Artist', 'Artist'])
    db.run('INSERT INTO songs (songId, artistId, title, titleNorm) VALUES (1, 1, ?, ?)', ['Song', 'Song'])
    db.run('INSERT INTO paths (pathId, path, priority, data) VALUES (1, ?, 0, ?)', [
      tempDir,
      JSON.stringify({ isManagedDownloadPath: true }),
    ])
    db.run(`
      INSERT INTO media (mediaId, songId, pathId, relPath, duration, isManagedDownload)
      VALUES (1, 1, 1, 'song.mp4', 240, 1)
    `)
  })

  afterEach(() => {
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('blocks a managed download until A2 is ready when scripting is disabled', () => {
    expect(getMediaQueueReadiness(1)).toBe('processing')
    expect(getSongQueueReadiness(1)).toBe('processing')
    expect(buildLibrarySnapshot(db, 1).songs.entities[1].isProcessing).toBe(true)
    expect(() => Queue.add({ roomId: 1, songId: 1, userId: 1 }))
      .toThrow('still preparing its instrumental track')

    db.run(`
      INSERT INTO audioTrackAnalysis
        (mediaId, audioTrackCount, ktvTrack, confidence, sourceSize, sourceMtimeMs,
          dateAnalyzed, duration, scriptReady)
      VALUES (1, 2, 1, 1, 100, 1000, 1000, 240, 0)
    `)

    expect(getMediaQueueReadiness(1)).toBe('ready')
    expect(getSongQueueReadiness(1)).toBe('ready')
    expect(buildLibrarySnapshot(db, 2).songs.entities[1].isProcessing).toBe(false)
    expect(() => Queue.add({ roomId: 1, songId: 1, userId: 1 })).not.toThrow()
  })

  it('allows a song when it also has a normal ready library file', () => {
    db.run('INSERT INTO paths (pathId, path, priority, data) VALUES (2, ?, 1, ?)', ['/library', '{}'])
    db.run(`
      INSERT INTO media (mediaId, songId, pathId, relPath, duration, isManagedDownload)
      VALUES (2, 1, 2, 'song.mp4', 240, 0)
    `)

    expect(getSongQueueReadiness(1)).toBe('ready')
    expect(buildLibrarySnapshot(db, 1).songs.entities[1].isProcessing).toBe(false)
  })
})
