import path from 'node:path'
import getLogger from '../lib/Log.js'
import Prefs from '../Prefs/Prefs.js'
import Media from '../Media/Media.js'
import { extractSongNameWithDeepSeek, type SongName } from '../Media/DeepSeekSongNamer.js'

const log = getLogger('AiSongNaming')

export function isManagedDownloadFilename (relPath: string): boolean {
  return /^YouTube-.*-YouTube \[[A-Za-z0-9_-]{11}\]$/
    .test(path.basename(relPath, path.extname(relPath)))
}

export function managedDownloadInput (file: string): string {
  return path.basename(file, path.extname(file))
    .replace(/^YouTube-/, '')
    .replace(/-YouTube \[[A-Za-z0-9_-]{11}\]$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

export function isManagedDownloadSong (songId: number): boolean {
  const result = Media.search({ songId })
  return result.result.length > 0
    && result.result.every(mediaId => !!result.entities[mediaId].isManagedDownload)
}

export async function renameManagedDownloadWithAi (songId: number): Promise<SongName & { songId: number }> {
  if (!Number.isInteger(songId)) throw new Error('Invalid songId')
  const apiKey = Prefs.getDeepSeekApiKey()
  if (!apiKey) throw new Error('Configure a DeepSeek API key in Admin > Preferences > Song Naming')

  const result = Media.search({ songId })
  if (!result.result.length) throw new Error('Song not found')
  if (result.result.some(mediaId => !result.entities[mediaId].isManagedDownload)) {
    throw new Error('Only YouTube downloads can be renamed with AI')
  }

  // Prefer a media file that still carries its original YouTube filename.
  const items = result.result.map(mediaId => result.entities[mediaId])
  const source = items.find(item => isManagedDownloadFilename(item.relPath)) || items[0]
  const input = managedDownloadInput(source.relPath)
  if (!input) throw new Error('The song has no name to analyze')

  const naming = await extractSongNameWithDeepSeek(input, apiKey)
  const renamed = await Media.renameSong(songId, naming.title, naming.artist)
  log.info('Renamed songId=%s to "%s-%s" with AI', renamed.songId, naming.artist, naming.title)
  return { songId: renamed.songId, ...naming }
}
