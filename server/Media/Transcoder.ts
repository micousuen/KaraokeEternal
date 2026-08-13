import crypto from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import getLogger from '../lib/Log.js'
import { runProcessText } from '../lib/runProcess.js'
import { BROWSER_MEDIA_VERSION, type SourceAudioTrack } from '../../shared/media.js'

export interface SourceMediaInfo {
  audioTrackCount: number
  audioTracks: SourceAudioTrack[]
  videoCodec: string | null
}

interface SourceAudioFile {
  file: string
  mimeType: string
}

type BrowserAudioFormat = 'aac' | 'mp3'
export type MediaJobPriority = 'playback' | 'background'

interface ScheduledJob {
  key: string
  priority: MediaJobPriority
  run: () => Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

export interface BrowserMediaPrefetch {
  audioFormat?: BrowserAudioFormat
  audioTracks?: number[]
  mediaId: number
  prepareCombined?: boolean
  prepareVideo: boolean
  source: string
}

const log = getLogger('Transcoder')
const pending = new Map<string, Promise<string>>()
const sourceInfoCache = new Map<string, SourceMediaInfo>()
const sourceInfoPending = new Map<string, Promise<SourceMediaInfo>>()
const prefetchQueue: Array<BrowserMediaPrefetch & { key: string }> = []
const prefetchedOrQueued = new Set<string>()
const activeCacheDirectories = new Map<string, number>()
let isPrefetching = false
let activePrefetchKey: string | undefined
let pruneQueue = Promise.resolve()
let pruneTimer: ReturnType<typeof setTimeout> | undefined
const processQueue: ScheduledJob[] = []
const scheduledJobs = new Map<string, ScheduledJob>()
let activeProcesses = 0

const cacheDir = process.env.KES_PATH_TRANSCODE
  || path.join(os.tmpdir(), 'karaoke-eternal-transcode')
const ffmpegPath = process.env.KES_PATH_FFMPEG || 'ffmpeg'
const ffprobePath = process.env.KES_PATH_FFPROBE || 'ffprobe'
const maxCacheBytes = Math.max(
  1,
  parseFloat(process.env.KES_TRANSCODE_MAX_SIZE_GB || '8') || 8,
) * 1024 ** 3
const maxProcesses = positiveInteger(process.env.KES_TRANSCODE_CONCURRENCY, 2)
const maxQueuedProcesses = positiveInteger(process.env.KES_TRANSCODE_QUEUE_LIMIT, 50)
const transcodeTimeoutMs = positiveInteger(process.env.KES_TRANSCODE_TIMEOUT_MS, 10 * 60_000)
const probeTimeoutMs = positiveInteger(process.env.KES_FFPROBE_TIMEOUT_MS, 30_000)

export async function getBrowserVideo (
  source: string,
  mediaId: number,
  priority: MediaJobPriority = 'playback',
): Promise<string> {
  return getArtifact(source, mediaId, 'video.mp4', output => run(ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', source,
    '-map', '0:v:0', '-an',
    '-c:v', 'libx264',
    '-preset', process.env.KES_TRANSCODE_PRESET || 'veryfast',
    '-crf', process.env.KES_TRANSCODE_CRF || '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output,
  ]), priority)
}

export async function getBrowserAudioTrack (
  source: string,
  mediaId: number,
  audioTrack: number,
  format: BrowserAudioFormat,
  priority: MediaJobPriority = 'playback',
): Promise<SourceAudioFile> {
  const isAac = format === 'aac'
  const file = await getArtifact(
    source,
    mediaId,
    `audio-${audioTrack + 1}.${isAac ? 'm4a' : 'mp3'}`,
    output => run(ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', source,
      '-map', `0:a:${audioTrack}`, '-vn',
      '-c:a', isAac ? 'aac' : 'libmp3lame',
      '-b:a', process.env.KES_TRANSCODE_AUDIO_BITRATE || '192k',
      ...(isAac ? ['-movflags', '+faststart'] : []),
      output,
    ]),
    priority,
  )
  return { file, mimeType: isAac ? 'audio/mp4' : 'audio/mpeg' }
}

export async function getBrowserCombined (
  source: string,
  mediaId: number,
  audioTrack: number,
  priority: MediaJobPriority = 'playback',
): Promise<string> {
  const [video, audio] = await Promise.all([
    getBrowserVideo(source, mediaId, priority),
    getBrowserAudioTrack(source, mediaId, audioTrack, 'aac', priority),
  ])
  return getArtifact(source, mediaId, `combined-${audioTrack + 1}.mp4`, output => run(ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', video, '-i', audio.file,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c', 'copy', '-movflags', '+faststart', '-shortest',
    output,
  ]), priority)
}

/**
 * Stream-copy one source audio track into a browser-native audio container.
 * Unlike browser fallback audio, this does not decode or re-encode the track.
 */
export async function getSourceAudio (
  source: string,
  mediaId: number,
  audioTrack: number,
  format: SourceAudioTrack,
  priority: MediaJobPriority = 'playback',
): Promise<SourceAudioFile> {
  if (!format.extension || !format.mimeType) throw new Error('Source audio format cannot be stream-copied')
  const file = await getArtifact(
    source,
    mediaId,
    `source-audio-${audioTrack + 1}.${format.extension}`,
    output => run(ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', source, '-map', `0:a:${audioTrack}`, '-vn', '-c:a', 'copy',
      ...(format.extension === 'm4a' ? ['-movflags', '+faststart'] : []),
      output,
    ]),
    priority,
  )
  return { file, mimeType: format.mimeType }
}

/**
 * Prepare media in the background, one item at a time. Keeping this queue
 * serial avoids five speculative FFmpeg jobs competing with current playback.
 */
export function prefetchBrowserMedia (items: BrowserMediaPrefetch[]): void {
  // Each request represents the latest playback order. Replace speculative
  // queued work so a newly prioritized song runs immediately after the active
  // FFmpeg job (active transcodes are intentionally not interrupted).
  for (const queued of prefetchQueue) prefetchedOrQueued.delete(queued.key)
  prefetchQueue.length = 0

  for (const item of items) {
    const { source, mediaId, prepareVideo } = item
    const key = `${mediaId}\0${source}\0${prepareVideo}\0${item.prepareCombined}\0${item.audioFormat}\0${item.audioTracks?.join(',')}`
    if (key === activePrefetchKey || prefetchedOrQueued.has(key)) continue

    prefetchedOrQueued.add(key)
    prefetchQueue.push({ ...item, key })
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
        const tasks: Promise<unknown>[] = []
        if (item.prepareVideo && !item.prepareCombined) {
          tasks.push(getBrowserVideo(item.source, item.mediaId, 'background'))
        }
        for (const audioTrack of item.audioTracks || []) {
          tasks.push(item.prepareCombined
            ? getBrowserCombined(item.source, item.mediaId, audioTrack, 'background')
            : getBrowserAudioTrack(item.source, item.mediaId, audioTrack, item.audioFormat || 'mp3', 'background'))
        }
        await Promise.all(tasks)
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

async function getArtifact (
  source: string,
  mediaId: number,
  name: string,
  prepare: (output: string) => Promise<void>,
  priority: MediaJobPriority,
): Promise<string> {
  const fingerprint = await sourceFingerprint(source)
  const directory = path.join(cacheDir, `${mediaId}-${fingerprint}`)
  const output = path.join(directory, name)

  if (await exists(output)) {
    markCacheUsed(directory)
    return output
  }

  const current = pending.get(output)
  if (current) {
    if (priority === 'playback') promoteScheduled(output)
    return current
  }

  const job = prepareArtifact(source, directory, output, mediaId, prepare, priority)
    .finally(() => pending.delete(output))
  pending.set(output, job)
  return job
}

async function prepareArtifact (
  source: string,
  directory: string,
  output: string,
  mediaId: number,
  prepare: (output: string) => Promise<void>,
  priority: MediaJobPriority,
): Promise<string> {
  await fsPromises.mkdir(cacheDir, { recursive: true })
  await fsPromises.mkdir(directory, { recursive: true })
  const partial = `${output}.partial-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  activeCacheDirectories.set(directory, (activeCacheDirectories.get(directory) || 0) + 1)
  log.info('Preparing browser media artifact mediaId=%s artifact=%s: %s', mediaId, path.basename(output), source)

  try {
    await scheduleProcess(output, priority, () => prepare(partial))
    await fsPromises.rename(partial, output)
    markCacheUsed(directory)
    scheduleStaleVersionCleanup(mediaId, directory)
    log.info('Browser media artifact ready mediaId=%s: %s', mediaId, output)
    return output
  } catch (err) {
    await fsPromises.rm(partial, { force: true })
    throw err
  } finally {
    const activeCount = activeCacheDirectories.get(directory) || 1
    if (activeCount === 1) activeCacheDirectories.delete(directory)
    else activeCacheDirectories.set(directory, activeCount - 1)
  }
}

export async function getSourceMediaInfo (source: string): Promise<SourceMediaInfo> {
  const key = `${source}\0${await sourceFingerprint(source)}`
  const cached = sourceInfoCache.get(key)
  if (cached) return cached
  const current = sourceInfoPending.get(key)
  if (current) return current

  const request = readSourceMediaInfo(source)
    .then((info) => {
      sourceInfoCache.set(key, info)
      while (sourceInfoCache.size > 1000) sourceInfoCache.delete(sourceInfoCache.keys().next().value!)
      return info
    })
    .finally(() => sourceInfoPending.delete(key))
  sourceInfoPending.set(key, request)
  return request
}

async function readSourceMediaInfo (source: string): Promise<SourceMediaInfo> {
  const stdout = await runCapture(ffprobePath, [
    '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,codec_tag_string', '-of', 'json', source,
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

function run (command: string, args: string[]): Promise<void> {
  return runProcessText(command, args, {
    maxStderrBytes: 8000,
    timeoutMs: transcodeTimeoutMs,
  }).then(() => undefined)
}

function runCapture (command: string, args: string[]): Promise<string> {
  return runProcessText(command, args, {
    maxStderrBytes: 8000,
    timeoutMs: probeTimeoutMs,
  }).then(output => output.stdout)
}

function scheduleProcess (key: string, priority: MediaJobPriority, operation: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (processQueue.length >= maxQueuedProcesses && priority === 'playback') dropLastBackgroundJob()
    if (processQueue.length >= maxQueuedProcesses) {
      reject(new MediaCapacityError())
      return
    }
    const job = { key, priority, run: operation, resolve, reject }
    scheduledJobs.set(key, job)
    processQueue.push(job)
    drainProcessQueue()
  })
}

function dropLastBackgroundJob (): void {
  for (let index = processQueue.length - 1; index >= 0; index--) {
    const job = processQueue[index]
    if (job.priority !== 'background') continue
    processQueue.splice(index, 1)
    scheduledJobs.delete(job.key)
    job.reject(new MediaCapacityError('Background media preparation was superseded by playback'))
    return
  }
}

export class MediaCapacityError extends Error {
  code = 'MEDIA_CAPACITY'

  constructor (message = 'Media preparation queue is busy; try again shortly') {
    super(message)
  }
}

function promoteScheduled (key: string): void {
  const job = scheduledJobs.get(key)
  if (!job || job.priority === 'playback') return
  const index = processQueue.indexOf(job)
  if (index === -1) return
  job.priority = 'playback'
}

function drainProcessQueue (): void {
  while (activeProcesses < maxProcesses && processQueue.length) {
    const playbackIndex = processQueue.findIndex(job => job.priority === 'playback')
    const job = processQueue.splice(playbackIndex < 0 ? 0 : playbackIndex, 1)[0]
    scheduledJobs.delete(job.key)
    activeProcesses++
    void job.run()
      .then(job.resolve, job.reject)
      .finally(() => {
        activeProcesses--
        drainProcessQueue()
      })
  }
}

function positiveInteger (value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
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

function markCacheUsed (directory: string): void {
  const now = new Date()
  void fsPromises.utimes(directory, now, now)
    .catch(() => undefined)
    .finally(schedulePrune)
}

function schedulePrune (): void {
  if (pruneTimer) return
  pruneTimer = setTimeout(() => {
    pruneTimer = undefined
    const queued = pruneQueue.then(pruneCache, pruneCache)
    pruneQueue = queued.catch(error => log.warn('Could not prune transcode cache: %s', error.message))
  }, 1000)
  pruneTimer.unref?.()
}

function scheduleStaleVersionCleanup (mediaId: number, keep: string): void {
  setTimeout(() => {
    void removeStaleVersions(mediaId, keep).catch((error) => {
      log.warn('Could not remove stale transcode cache for mediaId=%s: %s', mediaId, error.message)
    })
  }, 0).unref?.()
}

async function removeStaleVersions (mediaId: number, keep: string): Promise<void> {
  const entries = await fsPromises.readdir(cacheDir, { withFileTypes: true })
  await Promise.all(entries
    .filter(entry => entry.isDirectory()
      && entry.name.startsWith(`${mediaId}-`)
      && /^\d+-[a-f0-9]+(?:-audio|-source-audio-\d+)?$/.test(entry.name)
      && path.join(cacheDir, entry.name) !== keep
      && !activeCacheDirectories.has(path.join(cacheDir, entry.name)))
    .map(entry => fsPromises.rm(path.join(cacheDir, entry.name), { recursive: true, force: true })))
}

/** Serialize background pruning so cache accounting never delays playback. */
async function pruneCache (): Promise<void> {
  const prune = async () => {
    const entries = await fsPromises.readdir(cacheDir, { withFileTypes: true })
    const cacheEntries = await Promise.all(entries
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

    const removable = cacheEntries
      .filter(entry => !activeCacheDirectories.has(entry.directory))
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
    let totalBytes = cacheEntries.reduce((total, entry) => total + entry.size, 0)
    const remove = []

    for (const entry of removable) {
      if (totalBytes <= maxCacheBytes) break
      remove.push(entry)
      totalBytes -= entry.size
    }

    await Promise.all(remove.map(async ({ directory }) => {
      await fsPromises.rm(directory, { recursive: true, force: true })
      log.verbose('Removed old transcode cache entry: %s', directory)
    }))
  }
  await prune()
}
