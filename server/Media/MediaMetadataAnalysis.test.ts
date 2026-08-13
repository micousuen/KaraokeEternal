import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import { analyzeMediaMetadataIfStale } from './MediaMetadataAnalysis.js'

describe('persistent media metadata analysis', () => {
  let tempDir: string
  let source: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-metadata-'))
    source = path.join(tempDir, 'Artist-Title.mp4')
    fs.writeFileSync(source, 'first version')
    open({ file: path.join(tempDir, 'database.sqlite3'), ro: false })
    db.run('INSERT INTO artists (artistId, name, nameNorm) VALUES (1, ?, ?)', ['Artist', 'Artist'])
    db.run('INSERT INTO songs (songId, artistId, title, titleNorm) VALUES (1, 1, ?, ?)', ['Title', 'Title'])
    db.run('INSERT INTO paths (pathId, path, priority, data) VALUES (1, ?, 0, ?)', [tempDir, '{}'])
    db.run(`
      INSERT INTO media (mediaId, songId, pathId, relPath, duration)
      VALUES (1, 1, 1, 'Artist-Title.mp4', 0)
    `)
  })

  afterEach(() => {
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('persists analysis and only repeats it after the source changes', async () => {
    const readMetadata = vi.fn()
      .mockResolvedValueOnce({ duration: 61.4, parsed: {}, rgTrackGain: -3, rgTrackPeak: 0.8 })
      .mockResolvedValueOnce({ duration: 92.2, parsed: {}, rgTrackGain: -2, rgTrackPeak: 0.9 })

    await expect(analyzeMediaMetadataIfStale(1, source, readMetadata)).resolves.toBe(true)
    expect(db.get('SELECT duration, rgTrackGain, rgTrackPeak FROM media WHERE mediaId = 1'))
      .toEqual({ duration: 61, rgTrackGain: -3, rgTrackPeak: 0.8 })
    expect(db.get('SELECT sourceSize, sourceMtimeMs FROM mediaMetadataAnalysis WHERE mediaId = 1'))
      .toEqual({ sourceSize: 13, sourceMtimeMs: fs.statSync(source).mtimeMs })

    await expect(analyzeMediaMetadataIfStale(1, source, readMetadata)).resolves.toBe(false)
    expect(readMetadata).toHaveBeenCalledTimes(1)

    fs.appendFileSync(source, ' changed')
    await expect(analyzeMediaMetadataIfStale(1, source, readMetadata)).resolves.toBe(true)
    expect(readMetadata).toHaveBeenCalledTimes(2)
    expect(db.get('SELECT duration FROM media WHERE mediaId = 1')).toEqual({ duration: 92 })
  })
})
