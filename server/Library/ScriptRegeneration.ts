import fs from 'node:fs'
import path from 'node:path'
import fileTypes from '../Media/fileTypes.js'
import { getExt } from '../lib/util.js'

export interface ScriptRegenerationCandidate {
  isPreferred: boolean
  mediaId: number
  pathId: number
  songId: number
  source: string
}

interface MediaSearchResult {
  entities: Record<number, {
    isPreferred: boolean | number
    mediaId: number
    path: string
    pathId: number
    relPath: string
    songId: number
  }>
  result: number[]
}

export function findScriptRegenerationCandidates (
  media: MediaSearchResult,
  fileExists: (filename: string) => boolean = fs.existsSync,
): ScriptRegenerationCandidate[] {
  const candidates = new Map<number, ScriptRegenerationCandidate>()
  for (const mediaId of media.result) {
    const item = media.entities[mediaId]
    if (!item || !fileTypes[getExt(item.relPath)]?.mimeType.startsWith('video/')) continue
    const source = path.resolve(item.path, item.relPath)
    const script = path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.srt`)
    if (!fileExists(script)) continue

    const candidate = {
      isPreferred: !!item.isPreferred,
      mediaId: item.mediaId,
      pathId: item.pathId,
      songId: item.songId,
      source,
    }
    const existing = candidates.get(item.songId)
    if (!existing || (candidate.isPreferred && !existing.isPreferred)) candidates.set(item.songId, candidate)
  }
  return [...candidates.values()]
}
