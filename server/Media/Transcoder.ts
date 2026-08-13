import crypto from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import getLogger from '../lib/Log.js'
import { runProcessText } from '../lib/runProcess.js'
import { BROWSER_MEDIA_VERSION, type SourceAudioTrack } from '../../shared/media.js'

interface BrowserMediaBundle {
  video?: string
  audio: string[]
  audioAac: string[]
  combined: string[]
}

interface BundleManifest {
  video?: string
  audio: string[]
  audioAac: string[]
  combined: string[]
}

export interface SourceMediaInfo {
  audioTrackCount: number
  audioTracks: SourceAudioTrack[]
  videoCodec: string | null
}

interface SourceAudioFile {
  file: string
  mimeType: string
}
const log = getLogger('Transcoder')
const pending = new Map<string, Promise<BrowserMediaBundle>>()
const prefetchQueue: { source: string, mediaId: number, prepareVideo: boolean, key: string }[] = []
const prefetchedOrQueued = new Set<string>()
let isPrefetching = false
let activePrefetchKey: string | undefined
let pruneQueue = Promise.resolve()

const cacheDir = process.env.KES_PATH_TRANSCODE
  || path.join(os.tmpdir(), 'karaoke-eternal-transcode')
const ffmpegPath = process.env.KES_PATH_FFMPEG || 'ffmpeg'
const ffprobePath = process.env.KES_PATH_FFPROBE || 'ffprobe'
const maxCacheBytes = Math.max(
  1,
  parseFloat(process.env.KES_TRANSCODE_MAX_SIZE_GB || '8') || 8,
) * 1024 ** 3

/**
 * Return a browser-compatible bundle with silent H.264 video plus MP3 and AAC
 * alternatives for each source audio stream. Concurrent requests share one
 * preparation job.
 */
export async function getBrowserMedia (source: string, mediaId: number): Promise<BrowserMediaBundle> {
  return getBrowserBundle(source, mediaId, true)
}

/**
 * Return browser-ready audio without re-encoding a video stream that the
 * requesting player can decode directly.
 */
export async function getBrowserAudio (source: string, mediaId: number): Promise<BrowserMediaBundle> {
  return getBrowserBundle(source, mediaId, false)
}

async function getBrowserBundle (
  source: string,
  mediaId: number,
  includeVideo: boolean,
): Promise<BrowserMediaBundle> {
  const fingerprint = await sourceFingerprint(source)
  const output = path.join(cacheDir, `${mediaId}-${fingerprint}${includeVideo ? '' : '-audio'}`)
  const manifestFile = path.join(output, 'manifest.json')

  if (await exists(manifestFile)) {
    const now = new Date()
    await fsPromises.utimes(output, now, now)
    await pruneCache(output)
    return readBundle(output)
  }

  const current = pending.get(output)
  if (current) return current

  const job = transcode(source, output, mediaId, includeVideo)
    .finally(() => pending.delete(output))
  pending.set(output, job)
  return job
}

/**
 * Stream-copy one source audio track into a browser-native audio container.
 * Unlike the browser bundle, this does not decode or re-encode the audio.
 */
export async function getSourceAudio (
  source: string,
  mediaId: number,
  audioTrack: number,
  format: SourceAudioTrack,
): Promise<SourceAudioFile> {
  if (!format.extension || !format.mimeType) throw new Error('Source audio format cannot be stream-copied')
  const fingerprint = await sourceFingerprint(source)
  const output = path.join(cacheDir, `${mediaId}-${fingerprint}-source-audio-${audioTrack + 1}`)
  const file = path.join(output, `audio.${format.extension}`)

  if (await exists(file)) {
    const now = new Date()
    await fsPromises.utimes(output, now, now)
    await pruneCache(output)
    return { file, mimeType: format.mimeType }
  }

  const current = pending.get(file)
  if (current) {
    await current
    return { file, mimeType: format.mimeType }
  }

  const job = (async () => {
    await fsPromises.mkdir(cacheDir, { recursive: true })
    const partial = `${output}.partial`
    await fsPromises.rm(partial, { recursive: true, force: true })
    await fsPromises.mkdir(partial, { recursive: true })
    try {
      await run(ffmpegPath, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', source, '-map', `0:a:${audioTrack}`, '-vn', '-c:a', 'copy',
        ...(format.extension === 'm4a' ? ['-movflags', '+faststart'] : []),
        path.join(partial, path.basename(file)),
      ])
      await fsPromises.rm(output, { recursive: true, force: true })
      await fsPromises.rename(partial, output)
      await pruneCache(output)
    } catch (err) {
      await fsPromises.rm(partial, { recursive: true, force: true })
      throw err
    }
    return { video: undefined, audio: [], audioAac: [], combined: [] }
  })().finally(() => pending.delete(file))
  pending.set(file, job)
  await job
  return { file, mimeType: format.mimeType }
}

/**
 * Prepare media in the background, one item at a time. Keeping this queue
 * serial avoids five speculative FFmpeg jobs competing with current playback.
 */
export function prefetchBrowserMedia (items: { source: string, mediaId: number, prepareVideo: boolean }[]): void {
  // Each request represents the latest playback order. Replace speculative
  // queued work so a newly prioritized song runs immediately after the active
  // FFmpeg job (active transcodes are intentionally not interrupted).
  for (const queued of prefetchQueue) prefetchedOrQueued.delete(queued.key)
  prefetchQueue.length = 0

  for (const { source, mediaId, prepareVideo } of items) {
    const key = `${mediaId}\0${source}\0${prepareVideo}`
    if (key === activePrefetchKey || prefetchedOrQueued.has(key)) continue

    prefetchedOrQueued.add(key)
    prefetchQueue.push({ source, mediaId, prepareVideo, key })
  }

  if (!isPrefetching) void runPrefetchQueue()
}

async function runPrefetchQueue (): Promise<void> {
  isPrefetching = true

  try {
    while (prefetchQueue.length) {
      const item = prefetchQueue.shift()
      if (!item) continue
      activePrefetchKey = item.key

      try {
        await getBrowserBundle(item.source, item.mediaId, item.prepareVideo)
      } catch (err) {
        log.warn('Could not pre-cache mediaId=%s: %s', item.mediaId, err.message)
      } finally {
        prefetchedOrQueued.delete(item.key)
        activePrefetchKey = undefined
      }
    }
  } finally {
    isPrefetching = false
  }
}

async function transcode (
  source: string,
  output: string,
  mediaId: number,
  includeVideo: boolean,
): Promise<BrowserMediaBundle> {
  await fsPromises.mkdir(cacheDir, { recursive: true })

  // Remove only stale source versions. Keep the current full, audio-only, and
  // stream-copy bundles together so a fallback does not invalidate fast paths.
  const currentVersion = path.basename(output).replace(/-audio$/, '')
  const entries = await fsPromises.readdir(cacheDir)
  await Promise.all(entries
    .filter(file => file.startsWith(`${mediaId}-`) && !file.startsWith(currentVersion))
    .map(file => fsPromises.rm(path.join(cacheDir, file), { recursive: true, force: true })))

  const partial = `${output}.partial`
  await fsPromises.mkdir(partial, { recursive: true })

  log.info('Preparing browser media bundle mediaId=%s: %s', mediaId, source)

  try {
    const { audioTrackCount: audioCount } = await getSourceMediaInfo(source)
    if (audioCount === 0) throw new Error('Video contains no audio tracks')

    const videoName = 'video.mp4'
    const audioNames = Array.from({ length: audioCount }, (_, i) => `audio-${i + 1}.mp3`)
    const audioAacNames = Array.from({ length: audioCount }, (_, i) => `audio-${i + 1}.m4a`)
    const combinedNames = Array.from({ length: audioCount }, (_, i) => `combined-${i + 1}.mp4`)

    const conversions = [
      ...audioNames.map((name, i) => run(ffmpegPath, [
        '-nostdin',
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', source,
        '-map', `0:a:${i}`,
        '-vn',
        '-c:a', 'libmp3lame',
        '-b:a', process.env.KES_TRANSCODE_AUDIO_BITRATE || '192k',
        path.join(partial, name),
      ])),
      ...audioAacNames.map((name, i) => run(ffmpegPath, [
        '-nostdin',
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', source,
        '-map', `0:a:${i}`,
        '-vn',
        '-c:a', 'aac',
        '-b:a', process.env.KES_TRANSCODE_AUDIO_BITRATE || '192k',
        '-movflags', '+faststart',
        path.join(partial, name),
      ])),
    ]
    if (includeVideo) conversions.unshift(run(ffmpegPath, [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', source,
      '-map', '0:v:0',
      '-an',
      '-c:v', 'libx264',
      '-preset', process.env.KES_TRANSCODE_PRESET || 'veryfast',
      '-crf', process.env.KES_TRANSCODE_CRF || '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      path.join(partial, videoName),
    ]))
    await Promise.all(conversions)

    // webOS is substantially more reliable when audio and video share one
    // MP4. Stream-copy the prepared tracks, avoiding another encode.
    if (includeVideo) await Promise.all(combinedNames.map((name, i) => run(ffmpegPath, [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', path.join(partial, videoName),
      '-i', path.join(partial, audioAacNames[i]),
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c', 'copy',
      '-movflags', '+faststart',
      '-shortest',
      path.join(partial, name),
    ])))

    const manifest: BundleManifest = {
      ...(includeVideo ? { video: videoName } : {}),
      audio: audioNames,
      audioAac: audioAacNames,
      combined: combinedNames,
    }
    await fsPromises.writeFile(
      path.join(partial, 'manifest.json'),
      JSON.stringify(manifest),
      'utf8',
    )
    await fsPromises.rename(partial, output)
    await pruneCache(output)

    log.info('Browser media bundle ready mediaId=%s with %s audio track(s): %s',
      mediaId, audioCount, output)
    return resolveBundle(output, manifest)
  } catch (err) {
    await fsPromises.rm(partial, { recursive: true, force: true })
    throw err
  }
}

export async function getSourceMediaInfo (source: string): Promise<SourceMediaInfo> {
  const stdout = await runCapture(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,codec_tag_string',
    '-of', 'json',
    source,
  ])
  const probe = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string, codec_name?: string, codec_tag_string?: string }>
  }
  const streams = probe.streams || []
  const audioTracks = streams
    .filter(stream => stream.codec_type === 'audio')
    .map(stream => sourceAudioTrack(stream.codec_tag_string, stream.codec_name))
  const video = streams.find(stream => stream.codec_type === 'video')
  return {
    audioTrackCount: audioTracks.length,
    audioTracks,
    videoCodec: browserCodec(video?.codec_tag_string, video?.codec_name),
  }
}

function sourceAudioTrack (tag: string | undefined, name: string | undefined): SourceAudioTrack {
  const codec = browserCodec(tag, name)
  const format = ({
    aac: { extension: 'm4a', mimeType: 'audio/mp4' },
    alac: { extension: 'm4a', mimeType: 'audio/mp4' },
    mp3: { extension: 'mp3', mimeType: 'audio/mpeg' },
    opus: { extension: 'opus', mimeType: 'audio/ogg' },
    vorbis: { extension: 'ogg', mimeType: 'audio/ogg' },
    flac: { extension: 'flac', mimeType: 'audio/flac' },
  })[name || '']
  return { codec, extension: format?.extension || null, mimeType: format?.mimeType || null }
}

function browserCodec (tag: string | undefined, name: string | undefined): string | null {
  if (tag && /^[a-z0-9][a-z0-9._-]*$/i.test(tag)) return tag
  return ({
    h264: 'avc1',
    hevc: 'hvc1',
    av1: 'av01',
    vp9: 'vp09',
    vp8: 'vp8',
    mpeg4: 'mp4v',
    aac: 'mp4a',
    alac: 'alac',
    mp3: 'mp3',
    opus: 'opus',
    vorbis: 'vorbis',
    flac: 'flac',
  })[name || ''] || null
}

async function sourceFingerprint (source: string): Promise<string> {
  const stats = await fsPromises.stat(source)
  return crypto
    .createHash('sha256')
    .update(`${BROWSER_MEDIA_VERSION}\0${source}\0${stats.size}\0${stats.mtimeMs}`)
    .digest('hex')
    .slice(0, 16)
}

async function readBundle (directory: string): Promise<BrowserMediaBundle> {
  const manifest = JSON.parse(
    await fsPromises.readFile(path.join(directory, 'manifest.json'), 'utf8'),
  ) as BundleManifest
  return resolveBundle(directory, manifest)
}

function resolveBundle (directory: string, manifest: BundleManifest): BrowserMediaBundle {
  return {
    ...(manifest.video ? { video: path.join(directory, manifest.video) } : {}),
    audio: manifest.audio.map(file => path.join(directory, file)),
    audioAac: manifest.audioAac.map(file => path.join(directory, file)),
    combined: manifest.combined.map(file => path.join(directory, file)),
  }
}

function run (command: string, args: string[]): Promise<void> {
  return runProcessText(command, args, { maxStderrBytes: 8000 }).then(() => undefined)
}

function runCapture (command: string, args: string[]): Promise<string> {
  return runProcessText(command, args, { maxStderrBytes: 8000 }).then(output => output.stdout)
}

async function exists (file: string): Promise<boolean> {
  try {
    await fsPromises.access(file, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function getDirectorySize (directory: string): Promise<number> {
  const entries = await fsPromises.readdir(directory, { withFileTypes: true })
  const sizes = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory()
      ? getDirectorySize(file)
      : (await fsPromises.stat(file)).size
  }))
  return sizes.reduce((total, size) => total + size, 0)
}

/**
 * Serialize pruning so simultaneous transcodes cannot race while choosing the
 * least-recently-used bundles. The bundle used by this request is retained.
 */
async function pruneCache (keep: string): Promise<void> {
  const prune = async () => {
    const entries = await fsPromises.readdir(cacheDir, { withFileTypes: true })
    const bundles = await Promise.all(entries
      .filter(entry => entry.isDirectory() && /^\d+-[a-f0-9]+(?:-audio|-source-audio-\d+)?$/.test(entry.name))
      .map(async (entry) => {
        const directory = path.join(cacheDir, entry.name)
        const stats = await fsPromises.stat(directory)
        return {
          directory,
          mtimeMs: stats.mtimeMs,
          size: await getDirectorySize(directory),
        }
      }))

    const removable = bundles
      .filter(entry => entry.directory !== keep)
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
    let totalBytes = bundles.reduce((total, entry) => total + entry.size, 0)
    const remove = []

    for (const entry of removable) {
      if (totalBytes <= maxCacheBytes) break
      remove.push(entry)
      totalBytes -= entry.size
    }

    await Promise.all(remove.map(async ({ directory }) => {
      await fsPromises.rm(directory, { recursive: true, force: true })
      log.verbose('Removed old transcode cache bundle: %s', directory)
    }))
  }

  const queued = pruneQueue.then(prune, prune)
  pruneQueue = queued.catch(() => undefined)
  return queued
}
