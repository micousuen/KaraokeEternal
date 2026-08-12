import sql from 'sqlate'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import Queue from '../Queue/Queue.js'
import fsPromises from 'node:fs/promises'
import path from 'node:path'

const log = getLogger('Media')

class Media {
  static async renameSong (
    songId: number,
    requestedName: string,
    requestedArtist: string,
  ): Promise<{ songId: number }> {
    const name = requestedName.trim()
    const artist = requestedArtist.trim()
    if (!Number.isInteger(songId) || !name || name.length > 150 || !artist || artist.length > 150) {
      throw new Error('Song and author names must contain 1 to 150 characters')
    }
    if ([name, artist].some(value => value === '.' || value === '..' || /[<>:"/\\|?*]/.test(value)
      || [...value].some(char => char.charCodeAt(0) < 32))) {
      throw new Error('Song or author name contains unsupported filename characters')
    }

    const result = Media.search({ songId })
    if (!result.result.length) throw new Error('Song not found')
    const mediaItems = result.result.map(id => result.entities[id])
    const extension = path.extname(mediaItems[0].relPath)
    const title = name.toLowerCase().endsWith(extension.toLowerCase())
      ? path.basename(name, extension)
      : name
    const moves = mediaItems.map((media) => {
      const oldFile = path.resolve(media.path, media.relPath)
      const mediaExtension = path.extname(media.relPath)
      const newBasename = `${artist}-${title}${mediaExtension}`
      const relDirectory = path.posix.dirname(media.relPath)
      const newRelPath = relDirectory === '.' ? newBasename : path.posix.join(relDirectory, newBasename)
      return {
        mediaId: media.mediaId as number,
        oldFile,
        newFile: path.resolve(media.path, ...newRelPath.split('/')),
        newRelPath,
        oldScript: path.join(path.dirname(oldFile), `${path.basename(oldFile, mediaExtension)}.srt`),
        newScript: path.join(path.dirname(oldFile), `${path.basename(newBasename, mediaExtension)}.srt`),
        moveScript: false,
      }
    })
    if (moves.every(move => move.newFile === move.oldFile)
      && name === mediaItems[0].title && artist === mediaItems[0].artist) return { songId }

    for (const move of moves.filter(move => move.newFile !== move.oldFile)) {
      try {
        await fsPromises.access(move.newFile)
        throw new Error('A file with that name already exists')
      } catch (err) {
        if (err instanceof Error && !('code' in err && err.code === 'ENOENT')) throw err
      }
      try {
        await fsPromises.access(move.oldScript)
        move.moveScript = true
        try {
          await fsPromises.access(move.newScript)
          throw new Error('An SRT script with that name already exists')
        } catch (err) {
          if (err instanceof Error && !('code' in err && err.code === 'ENOENT')) throw err
        }
      } catch (err) {
        if (err instanceof Error && !('code' in err && err.code === 'ENOENT')) throw err
      }
    }

    const completedMoves: typeof moves = []
    const completedScriptMoves: typeof moves = []
    try {
      for (const move of moves.filter(move => move.newFile !== move.oldFile)) {
        await fsPromises.rename(move.oldFile, move.newFile)
        completedMoves.push(move)
        if (move.moveScript) {
          await fsPromises.rename(move.oldScript, move.newScript)
          completedScriptMoves.push(move)
        }
      }
      db.exec('BEGIN IMMEDIATE')
      for (const move of moves) {
        db.run('UPDATE media SET relPath = ?, dateUpdated = ? WHERE mediaId = ?', [
          move.newRelPath,
          Math.round(Date.now() / 1000),
          move.mediaId,
        ])
      }
      const titleNorm = normalizeLibraryName(title)
      const artistNorm = normalizeLibraryName(artist)
      let artistId = db.get<{ artistId: number }>('SELECT artistId FROM artists WHERE nameNorm = ?', [artistNorm])?.artistId
      if (!artistId) {
        artistId = Number(db.run('INSERT INTO artists (name, nameNorm) VALUES (?, ?)', [artist, artistNorm]).lastID)
      }

      const targetSong = db.get<{ songId: number }>(
        'SELECT songId FROM songs WHERE artistId = ? AND titleNorm = ? AND songId != ?',
        [artistId, titleNorm, songId],
      )
      if (targetSong) {
        db.run('UPDATE media SET songId = ? WHERE songId = ?', [targetSong.songId, songId])
        db.run('UPDATE queue SET songId = ? WHERE songId = ?', [targetSong.songId, songId])
        db.run(`
          INSERT OR IGNORE INTO songStars (userId, songId)
          SELECT userId, ? FROM songStars WHERE songId = ?
        `, [targetSong.songId, songId])
        db.run('DELETE FROM songStars WHERE songId = ?', [songId])
        db.run('DELETE FROM songs WHERE songId = ?', [songId])
        songId = targetSong.songId
      } else {
        db.run('UPDATE songs SET artistId = ?, title = ?, titleNorm = ? WHERE songId = ?', [
          artistId,
          title,
          titleNorm,
          songId,
        ])
      }
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // The transaction may have failed before BEGIN completed.
      }
      for (const move of completedScriptMoves.reverse()) await fsPromises.rename(move.newScript, move.oldScript)
      for (const move of completedMoves.reverse()) await fsPromises.rename(move.newFile, move.oldFile)
      throw err
    }
    return { songId }
  }

  /**
   * Get media matching all search criteria
   */
  static search (filter: object): { result: number[], entities: Record<string, any> } {
    const media = {
      result: [],
      entities: {},
    }

    const whereClause = typeof filter !== 'object'
      ? sql`true`
      : sql`${sql.tuple(Object.keys(filter).map(sql.column))} = ${sql.tuple(Object.values(filter))}`

    const query = sql`
      SELECT
        media.*,
        songs.*,
        artists.artistId, artists.name AS artist, artists.nameNorm AS artistNorm,
        paths.pathId, paths.path, paths.data AS pathData
      FROM media
        INNER JOIN songs USING (songId)
        INNER JOIN artists USING (artistId)
        INNER JOIN paths USING (pathId)
      WHERE ${whereClause}
      ORDER BY paths.priority ASC
    `
    const rows = db.all<{ mediaId: number } & Record<string, any>>(String(query), query.parameters)

    for (const row of rows) {
      media.result.push(row.mediaId)
      media.entities[row.mediaId] = row
    }

    return media
  }

  /**
   * Add media file to the library
   */
  static add (media: any): number {
    if (!Number.isInteger(media.songId)
      || !Number.isInteger(media.duration)
      || !Number.isInteger(media.pathId)
      || !media.relPath
    ) throw new Error('invalid media data: ' + JSON.stringify(media))

    // currently uses an Object instead of Map
    const values = Object.values(media).map(value => typeof value === 'boolean' ? Number(value) : value)
    const query = sql`
      INSERT INTO media ${sql.tuple(Object.keys(media).map(sql.column))}
      VALUES ${sql.tuple(values)}
    `
    const res = db.run(String(query), query.parameters)

    if (!Number.isInteger(res.lastID)) {
      throw new Error('invalid lastID from media insert')
    }

    return res.lastID
  }

  /**
   * Update media item
   */
  static update (media: any): void {
    const { mediaId } = media

    if (!Number.isInteger(mediaId)) {
      throw new Error(`invalid mediaId: ${mediaId}`)
    }

    // currently uses an Object instead of Map
    delete media.mediaId

    const query = sql`
      UPDATE media
      SET ${sql.tuple(Object.keys(media).map(sql.column))} = ${sql.tuple(Object.values(media))}
      WHERE mediaId = ${mediaId}
    `
    db.run(String(query), query.parameters)
  }

  /**
   * Removes media from the db in sqlite-friendly batches
   */
  static remove (mediaIds: number[]): void {
    const batchSize = 999

    while (mediaIds.length) {
      const query = sql`
        DELETE FROM media
        WHERE mediaId IN ${sql.in(mediaIds.splice(0, batchSize))}
      `
      const res = db.run(String(query), query.parameters)

      log.info(`removed ${res.changes} media`)
    }
  }

  /**
   * Remove unlinked items and VACUUM
   */
  static cleanup (): void {
    let res

    // remove media in nonexistent paths
    res = db.run(`
      DELETE FROM media WHERE mediaId IN (
        SELECT media.mediaId FROM media LEFT JOIN paths USING(pathId) WHERE paths.pathId IS NULL
      )
    `)
    log.info(`cleanup: ${res.changes} media in nonexistent paths`)

    // remove songs without associated media
    res = db.run(`
      DELETE FROM songs WHERE songId IN (
        SELECT songs.songId FROM songs LEFT JOIN media USING(songId) WHERE media.mediaId IS NULL
      )
    `)
    log.info(`cleanup: ${res.changes} songs with no associated media`)

    // remove stars for nonexistent songs
    res = db.run(`
      DELETE FROM songStars WHERE songId IN (
        SELECT songStars.songId FROM songStars LEFT JOIN songs USING(songId) WHERE songs.songId IS NULL
      )
    `)
    log.info(`cleanup: ${res.changes} stars for nonexistent songs`)

    // remove queue items for nonexistent songs
    const rows = db.all<{ queueId: number }>(`
      SELECT queue.queueId FROM queue LEFT JOIN songs USING(songId) WHERE songs.songId IS NULL
    `)

    for (const row of rows) {
      Queue.remove(row.queueId)
    }

    log.info(`cleanup: ${rows.length} queue items for nonexistent songs`)

    log.info('cleanup: vacuuming database')
    db.run('VACUUM')
  }

  /**
   * Set isPreferred flag for a given media item
   */
  static setPreferred (mediaId: number, isPreferred: boolean): number {
    if (!Number.isInteger(mediaId) || typeof isPreferred !== 'boolean') {
      throw new Error('invalid mediaId or value')
    }

    // get songId
    const res = Media.search({ mediaId })

    if (!res.result.length) {
      throw new Error(`mediaId not found: ${mediaId}`)
    }

    const songId = res.entities[mediaId].songId

    // clear any currently preferred items
    const query = sql`
      UPDATE media
      SET isPreferred = 0
      WHERE songId = ${songId}
    `
    db.run(String(query), query.parameters)

    if (isPreferred) {
      Media.update({ mediaId, isPreferred: 1 })
    }

    return songId
  }
}

function normalizeLibraryName (value: string): string {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(' & ', ' and ')
    .replace(/[^\p{L}\p{N}\s\p{M}]/gu, '')
}

export default Media
