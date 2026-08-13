import sql from 'sqlate'
import { db } from '../lib/Database.js'
import getLogger from '../lib/Log.js'
import { performance } from 'perf_hooks'
import { Worker } from 'node:worker_threads'
import { Song, Artist } from '../../shared/types.js'
import Media from '../Media/Media.js'
import type { LibrarySnapshot } from './LibrarySnapshot.js'

const log = getLogger('Library')
let lastCacheVersion = 0

class Library {
  static cache: Partial<Omit<LibrarySnapshot, 'version'>> & { version: number | null } = { version: null }
  static pendingBuild: Promise<void> | undefined

  static starCountsCache: {
    version: number | null
    artists?: Record<number, number>
    songs?: Record<number, number>
  } = { version: null }

  static getVersion (): number {
    if (this.cache.version === null) this.cache = { version: nextCacheVersion() }
    return this.cache.version
  }

  static invalidate (): number {
    const version = nextCacheVersion()
    this.cache = { version }
    return version
  }

  static async getAsync (): Promise<LibrarySnapshot> {
    while (!this.cache.artists || !this.cache.songs) await this.prepare()
    return this.cache as LibrarySnapshot
  }

  static prepare (): Promise<void> {
    if (this.cache.artists && this.cache.songs) return Promise.resolve()
    if (this.pendingBuild) return this.pendingBuild
    const version = this.getVersion()
    this.pendingBuild = buildLibrarySnapshotInWorker(db.config.filename, version)
      .then((snapshot) => {
        if (this.cache.version === snapshot.version) this.cache = snapshot
        return undefined
      })
      .finally(() => { this.pendingBuild = undefined })
    return this.pendingBuild
  }

  /**
  * Get single song in format similar to get()
  */
  static getSong (songId: number): Record<number, Song> {
    const { result, entities } = Media.search({ songId })
    if (!result.length) return {}

    // should be in order of path priority...
    let media = entities[result[0]]

    // ...but are any preferred?
    for (const mediaId of result) {
      if (entities[mediaId].isPreferred) media = entities[mediaId]
    }

    return {
      [songId]: {
        artistId: media.artistId,
        duration: media.duration,
        language: media.language,
        songId: media.songId,
        title: media.title,
        numMedia: result.length,
        isManagedDownload: result.some(mediaId => !!entities[mediaId].isManagedDownload || isManagedDownloadPath(entities[mediaId].pathData)),
        hasSingleAudioTrack: db.get<{ audioTrackCount: number }>(
          'SELECT audioTrackCount FROM audioTrackAnalysis WHERE mediaId = ?',
          [media.mediaId],
        )?.audioTrackCount === 1,
      },
    }
  }

  /** Build a small library payload for songs discovered during an active scan. */
  static getScanBatch (songIds: number[]): {
    artists: { result: number[], entities: Record<number, Artist> }
    songs: { result: number[], entities: Record<number, Song> }
  } {
    const artists = { result: [], entities: {} }
    const songs = { result: [], entities: {} }
    if (!songIds.length) return { artists, songs }

    const query = sql`
      SELECT artists.artistId, artists.name, songs.songId, songs.title, songs.language,
        MAX(media.duration) AS duration, COUNT(DISTINCT media.mediaId) AS numMedia,
        MAX(media.isManagedDownload OR COALESCE(json_extract(paths.data, '$.isManagedDownloadPath'), 0)) AS isManagedDownload,
        MAX(COALESCE(audioTrackAnalysis.audioTrackCount, 0)) = 1 AS hasSingleAudioTrack
      FROM songs
        INNER JOIN artists USING (artistId)
        INNER JOIN media USING (songId)
        INNER JOIN paths USING (pathId)
        LEFT JOIN audioTrackAnalysis USING (mediaId)
      WHERE songs.songId IN ${sql.in(songIds.slice(0, 999))}
      GROUP BY songs.songId
      ORDER BY songs.titleNorm
    `
    const rows = db.all<Omit<Song, 'isManagedDownload' | 'hasSingleAudioTrack'> & {
      name: string
      isManagedDownload: number
      hasSingleAudioTrack: number
    }>(String(query), query.parameters)

    for (const row of rows) {
      const { artistId, name, ...song } = row
      songs.result.push(song.songId)
      songs.entities[song.songId] = {
        artistId,
        ...song,
        isManagedDownload: !!song.isManagedDownload,
        hasSingleAudioTrack: !!song.hasSingleAudioTrack,
      }

      if (!artists.entities[artistId]) {
        artists.result.push(artistId)
        artists.entities[artistId] = { artistId, name, songIds: [] }
      }
      artists.entities[artistId].songIds.push(song.songId)
    }

    return { artists, songs }
  }

  /**
  * Matches or creates artist and song
  */
  static matchSong (parsed: { artist: string, artistNorm: string, title: string, titleNorm: string, language?: string }): {
    artistId?: number
    artist?: string
    artistNorm?: string
    songId?: number
    title?: string
    titleNorm?: string
  } {
    const match: { artistId?: number, artist?: string, artistNorm?: string, songId?: number, title?: string, titleNorm?: string } = {}

    // match artist
    {
      const query = sql`
        SELECT *
        FROM artists
        WHERE nameNorm = ${parsed.artistNorm}
      `
      const row = db.get<{ artistId: number, name: string, nameNorm: string }>(String(query), query.parameters)

      if (row) {
        log.debug('matched artist: %s', row.name)
        match.artistId = row.artistId
        match.artist = row.name
        match.artistNorm = row.nameNorm
      } else {
        log.debug('new artist: %s', parsed.artist)

        const fields = new Map()
        fields.set('name', parsed.artist)
        fields.set('nameNorm', parsed.artistNorm)

        const query = sql`
          INSERT INTO artists ${sql.tuple(Array.from(fields.keys()).map(sql.column))}
          VALUES ${sql.tuple(Array.from(fields.values()))}
        `
        const res = db.run(String(query), query.parameters)

        if (!Number.isInteger(res.lastID)) {
          throw new Error('invalid artistId after insert')
        }

        match.artistId = res.lastID
        match.artist = parsed.artist
        match.artistNorm = parsed.artistNorm
      }
    }

    // match song title
    {
      const query = sql`
        SELECT *
        FROM songs
        WHERE artistId = ${match.artistId} AND titleNorm = ${parsed.titleNorm}
      `
      const row = db.get<{ songId: number, title: string, titleNorm: string, language: string | null }>(String(query), query.parameters)

      if (row) {
        log.debug('matched song: %s', row.title)
        if (parsed.language && row.language !== parsed.language) {
          db.run('UPDATE songs SET language = ? WHERE songId = ?', [parsed.language, row.songId])
          this.invalidate()
        }
        match.songId = row.songId
        match.title = row.title
        match.titleNorm = row.titleNorm
      } else {
        log.debug('new song: %s', parsed.title)

        const fields = new Map()
        fields.set('artistId', match.artistId)
        fields.set('title', parsed.title)
        fields.set('titleNorm', parsed.titleNorm)
        if (parsed.language) fields.set('language', parsed.language)

        const query = sql`
          INSERT INTO songs ${sql.tuple(Array.from(fields.keys()).map(sql.column))}
          VALUES ${sql.tuple(Array.from(fields.values()))}
        `
        const res = db.run(String(query), query.parameters)

        if (!Number.isInteger(res.lastID)) {
          throw new Error('invalid songId after insert')
        }

        match.songId = res.lastID
        match.title = parsed.title
        match.titleNorm = parsed.titleNorm
      }
    }

    return match
  }

  /**
  * Gets a user's starred artists and songs
  */
  static getUserStars (userId: number): { starredArtists: number[], starredSongs: number[] } {
    let starredArtists, starredSongs

    // get starred artists
    {
      const query = sql`
        SELECT artistId
        FROM artistStars
        WHERE userId = ${userId}
      `
      const rows = db.all<{ artistId: number }>(String(query), query.parameters)

      starredArtists = rows.map(row => row.artistId)
    }

    // get starred songs
    {
      const query = sql`
        SELECT songId
        FROM songStars
        WHERE userId = ${userId}
      `
      const rows = db.all<{ songId: number }>(String(query), query.parameters)

      starredSongs = rows.map(row => row.songId)
    }

    return { starredArtists, starredSongs }
  }

  /**
  * Add a user's star to a song
  */
  static starSong (songId: number, userId: number): number {
    const fields = new Map()
    fields.set('songId', songId)
    fields.set('userId', userId)

    const query = sql`
      INSERT OR IGNORE INTO songStars ${sql.tuple(Array.from(fields.keys()).map(sql.column))}
      VALUES ${sql.tuple(Array.from(fields.values()))}
    `
    const res = db.run(String(query), query.parameters)

    if (res.changes) {
      // invalidate cache
      this.starCountsCache.version = null
    }

    return res.changes
  }

  /**
  * Remove a user's star from a song
  */
  static unstarSong (songId: number, userId: number): number {
    const query = sql`
      DELETE FROM songStars
      WHERE userId = ${userId} AND songId = ${songId}
    `
    const res = db.run(String(query), query.parameters)

    if (res.changes) {
      // invalidate cache
      this.starCountsCache.version = null
    }

    return res.changes
  }

  /**
  * Gets artist and song star counts
  */
  static getStarCounts (): typeof Library.starCountsCache {
    // already cached?
    if (this.starCountsCache.version) return this.starCountsCache

    const startTime = performance.now()

    const artists = {}
    const songs = {}

    // get artist star counts
    {
      const query = sql`
        SELECT artistId, COUNT(userId) AS count
        FROM artistStars
        GROUP BY artistId
      `
      const rows = db.all<{ artistId: number, count: number }>(String(query), query.parameters)

      rows.forEach((row) => {
        artists[row.artistId] = row.count
      })
    }

    // get song star counts
    {
      const query = sql`
        SELECT songId, COUNT(userId) AS count
        FROM songStars
        GROUP BY songId
      `
      const rows = db.all<{ songId: number, count: number }>(String(query), query.parameters)

      rows.forEach((row) => {
        songs[row.songId] = row.count
      })
    }

    log.info('built star count cache in %sms', (performance.now() - startTime).toFixed(3))

    this.starCountsCache = {
      artists,
      songs,
      version: nextCacheVersion(),
    }

    return this.starCountsCache
  }
}

function nextCacheVersion (): number {
  lastCacheVersion = Math.max(Date.now(), lastCacheVersion + 1)
  return lastCacheVersion
}

function buildLibrarySnapshotInWorker (databaseFile: string, version: number): Promise<LibrarySnapshot> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./librarySnapshotWorker.js', import.meta.url), {
      execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
      workerData: { databaseFile, version },
    })
    const timeoutMs = 2 * 60_000
    let settled = false
    const timeout = setTimeout(() => finish(new Error(`library cache worker timed out after ${timeoutMs}ms`)), timeoutMs)
    timeout.unref()
    const finish = (error?: Error, snapshot?: LibrarySnapshot) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate()
      if (error) reject(error)
      else resolve(snapshot!)
    }
    worker.once('message', (message) => {
      if (message.ok) finish(undefined, message.snapshot)
      else finish(new Error(message.error))
    })
    worker.once('error', error => finish(error instanceof Error ? error : new Error(String(error))))
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`library cache worker exited without a result (code ${code})`))
    })
  })
}

function isManagedDownloadPath (data: unknown): boolean {
  if (typeof data !== 'string') return false
  try {
    return !!JSON.parse(data).isManagedDownloadPath
  } catch {
    return false
  }
}

export default Library
