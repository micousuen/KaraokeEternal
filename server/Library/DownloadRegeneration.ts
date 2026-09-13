import fs from 'node:fs'
import path from 'node:path'
import fileTypes from '../Media/fileTypes.js'
import { getExt } from '../lib/util.js'
import { isManagedDownloadFilename } from '../YouTube/AiSongNaming.js'

export interface DownloadProcessingCandidate {
  isPreferred: boolean
  mediaId: number
  pathId: number
  songId: number
  source: string
}

interface MediaEntity {
  isManagedDownload?: boolean | number
  isPreferred: boolean | number
  mediaId: number
  path: string
  pathData?: string
  pathId: number
  relPath: string
  songId: number
}

interface MediaSearchResult {
  entities: Record<number, MediaEntity>
  result: number[]
}

export function findScriptRegenerationCandidates (
  media: MediaSearchResult,
  fileExists: (filename: string) => boolean = fs.existsSync,
): DownloadProcessingCandidate[] {
  return pickOnePerSong(media, item => (
    isManagedDownloadMedia(item)
    && fileTypes[getExt(item.relPath)]?.mimeType.startsWith('video/')
    && fileExists(scriptFor(item))
  ))
}

export function findInstrumentalRegenerationCandidates (media: MediaSearchResult): DownloadProcessingCandidate[] {
  return pickOnePerSong(media, item => (
    isManagedDownloadMedia(item)
    && fileTypes[getExt(item.relPath)]?.mimeType.startsWith('video/')
  ))
}

export function findNameReparsingCandidates (media: MediaSearchResult): number[] {
  const songs = new Map<number, { hasLibraryMedia: boolean, hasWrappedFilename: boolean }>()
  for (const mediaId of media.result) {
    const item = media.entities[mediaId]
    if (!item) continue
    const entry = songs.get(item.songId) || { hasLibraryMedia: false, hasWrappedFilename: false }
    if (!isManagedDownloadMedia(item)) entry.hasLibraryMedia = true
    if (isManagedDownloadFilename(item.relPath)) entry.hasWrappedFilename = true
    songs.set(item.songId, entry)
  }
  return [...songs.entries()]
    .filter(([, state]) => !state.hasLibraryMedia && state.hasWrappedFilename)
    .map(([songId]) => songId)
}

function pickOnePerSong (
  media: MediaSearchResult,
  qualifies: (item: MediaEntity) => boolean,
): DownloadProcessingCandidate[] {
  const candidates = new Map<number, DownloadProcessingCandidate>()
  for (const mediaId of media.result) {
    const item = media.entities[mediaId]
    if (!item || !qualifies(item)) continue
    const candidate = {
      isPreferred: !!item.isPreferred,
      mediaId: item.mediaId,
      pathId: item.pathId,
      songId: item.songId,
      source: path.resolve(item.path, item.relPath),
    }
    const existing = candidates.get(item.songId)
    if (!existing || (candidate.isPreferred && !existing.isPreferred)) candidates.set(item.songId, candidate)
  }
  return [...candidates.values()]
}

function scriptFor (item: MediaEntity): string {
  const source = path.resolve(item.path, item.relPath)
  return path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.srt`)
}

function isManagedDownloadMedia (item: MediaEntity): boolean {
  return !!item.isManagedDownload || isManagedDownloadPath(item.pathData)
}

function isManagedDownloadPath (data: unknown): boolean {
  if (typeof data !== 'string' || !data) return false
  try {
    const parsed = JSON.parse(data)
    return !!parsed && typeof parsed === 'object' && parsed.isManagedDownloadPath === true
  } catch {
    return false
  }
}
