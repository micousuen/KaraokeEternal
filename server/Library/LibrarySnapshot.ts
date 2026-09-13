import type { DatabaseWrapper } from '../lib/Database.js'
import type { Artist, Song } from '../../shared/types.js'
import { loadVocalSeparationConfig } from '../Media/VocalSeparationConfig.js'
import { compareLibrarySortMetadata, getLibrarySortMetadata } from './LibrarySort.js'

// Keep this worker-safe: importing MediaQueueReadiness here would eagerly load
// Database and its logger before librarySnapshotWorker initializes either one.
const managedDownloadsRequireScript = loadVocalSeparationConfig().scripting.enabled

export interface LibrarySnapshot {
  version: number
  artists: { result: number[], entities: Record<number, Artist> }
  songs: { result: number[], entities: Record<number, Song> }
}

export function buildLibrarySnapshot (database: DatabaseWrapper, version: number): LibrarySnapshot {
  const songIdsByArtist: Record<number, number[]> = {}
  const artists: LibrarySnapshot['artists'] = { result: [], entities: {} }
  const songs: LibrarySnapshot['songs'] = { result: [], entities: {} }
  const songRows = database.all<Omit<Song, 'sortKey' | 'sortLetter' | 'isManagedDownload' | 'hasSingleAudioTrack' | 'isProcessing'> & {
    isPreferred: number
    isManagedDownload: number
    hasSingleAudioTrack: number
    isQueueReady: number
  }>(`
    SELECT media.duration AS duration, songs.artistId AS artistId, songs.songId AS songId, songs.title AS title,
      songs.language AS language, songs.requestCount AS requestCount,
      MAX(isPreferred) AS isPreferred, COUNT(DISTINCT media.mediaId) AS numMedia,
      MAX(media.dateAdded) AS dateAdded,
      MAX(media.isManagedDownload OR COALESCE(json_extract(paths.data, '$.isManagedDownloadPath'), 0)) AS isManagedDownload,
      MAX(COALESCE(audioTrackAnalysis.audioTrackCount, 0)) = 1 AS hasSingleAudioTrack,
      MAX(CASE WHEN
        (media.isManagedDownload OR COALESCE(json_extract(paths.data, '$.isManagedDownloadPath'), 0)) = 0
        OR (COALESCE(audioTrackAnalysis.audioTrackCount, 0) >= 2
          AND (? = 0 OR COALESCE(audioTrackAnalysis.scriptReady, 0) = 1))
        THEN 1 ELSE 0
      END) AS isQueueReady
    FROM media
      INNER JOIN songs USING (songId)
      INNER JOIN paths USING (pathId)
      LEFT JOIN audioTrackAnalysis USING (mediaId)
    GROUP BY songId
    ORDER BY songs.titleNorm, paths.priority ASC
  `, [Number(managedDownloadsRequireScript)])

  for (const row of songRows) {
    const song = { ...row }
    delete song.isPreferred
    delete song.isQueueReady
    songs.entities[row.songId] = {
      ...song,
      ...getLibrarySortMetadata(row.title),
      isManagedDownload: !!row.isManagedDownload,
      hasSingleAudioTrack: !!row.hasSingleAudioTrack,
      isProcessing: !!row.isManagedDownload && !row.isQueueReady,
    }
    songs.result.push(row.songId)
    ;(songIdsByArtist[row.artistId] ||= []).push(row.songId)
  }

  const artistRows = database.all<Pick<Artist, 'artistId' | 'name'>>('SELECT artistId, name FROM artists')
  for (const row of artistRows) {
    const songIds = songIdsByArtist[row.artistId]
    if (!songIds) continue
    artists.result.push(row.artistId)
    artists.entities[row.artistId] = {
      ...row,
      ...getLibrarySortMetadata(row.name),
      requestCount: songIds.reduce((total, songId) => total + songs.entities[songId].requestCount, 0),
      songIds,
    }
  }

  songs.result.sort((leftId, rightId) =>
    compareLibrarySortMetadata(songs.entities[leftId], songs.entities[rightId]) || leftId - rightId)
  artists.result.sort((leftId, rightId) =>
    compareLibrarySortMetadata(artists.entities[leftId], artists.entities[rightId]) || leftId - rightId)
  for (const artist of Object.values(artists.entities)) {
    artist.songIds.sort((leftId, rightId) =>
      compareLibrarySortMetadata(songs.entities[leftId], songs.entities[rightId]) || leftId - rightId)
  }

  return { artists, songs, version }
}
