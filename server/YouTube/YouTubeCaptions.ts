import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { runProcessText } from '../lib/runProcess.js'

const VIDEO_ID_IN_FILENAME = /YouTube \[([A-Za-z0-9_-]{11})\](?:\.[^.]+)?$/
const CAPTION_PREFIX = 'youtube-creator-caption'

export interface CreatorCaption {
  file: string
  language: string
}

export function youtubeVideoIdFromFilename (filename: string): string | undefined {
  return path.basename(filename).match(VIDEO_ID_IN_FILENAME)?.[1]
}

export function selectCreatorCaption (files: string[], outputDir: string): CreatorCaption | undefined {
  const candidates = files.flatMap((file) => {
    const match = file.match(new RegExp(`^${CAPTION_PREFIX}\\.([^.]+)\\.srt$`, 'i'))
    if (!match) return []
    const language = match[1].split('-')[0].toLowerCase()
    if (!/^[a-z]{2,3}$/.test(language)) return []
    return [{ file: path.join(outputDir, file), language, track: match[1] }]
  }).sort((left, right) => left.track.length - right.track.length || left.track.localeCompare(right.track))
  // YouTube does not reliably expose which manual track matches the sung
  // language. A translated caption would align badly and is less useful than
  // ASR, so only take the fast path when all available tracks agree.
  if (!candidates.length || new Set(candidates.map(candidate => candidate.language)).size > 1) return undefined
  return { file: candidates[0].file, language: candidates[0].language }
}

export async function downloadCreatorCaption (
  videoId: string,
  outputDir: string,
): Promise<CreatorCaption | undefined> {
  const args = [
    '--ignore-config',
    '--skip-download',
    '--write-subs',
    '--sub-langs', 'all,-live_chat',
    '--sub-format', 'srt',
    '--force-ipv4',
    '--js-runtimes', 'node',
    '--output', path.join(outputDir, CAPTION_PREFIX),
  ]
  const providerUrl = process.env.KES_YOUTUBE_POT_PROVIDER_URL
  if (providerUrl) {
    args.push('--extractor-args', 'youtube:player-client=web_embedded')
    args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${providerUrl}`)
  }
  args.push(`https://www.youtube.com/watch?v=${videoId}`)

  await runProcessText('yt-dlp', args, {
    timeoutMs: 30_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 16 * 1024,
  })
  return selectCreatorCaption(await fsPromises.readdir(outputDir), outputDir)
}
