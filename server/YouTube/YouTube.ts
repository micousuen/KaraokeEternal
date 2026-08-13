import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import getLogger from '../lib/Log.js'
import Prefs from '../Prefs/Prefs.js'
import Media from '../Media/Media.js'
import Queue from '../Queue/Queue.js'
import type { YouTubeJob } from '../../shared/types.js'
import { ProcessExecutionError, runProcessText } from '../lib/runProcess.js'

const log = getLogger('YouTube')
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const MAX_DOWNLOAD_HEIGHT = 1080
const DOWNLOAD_FORMAT = [
  `bv*[height<=${MAX_DOWNLOAD_HEIGHT}][ext=mp4]+ba[ext=m4a]`,
  `b[height<=${MAX_DOWNLOAD_HEIGHT}][ext=mp4]`,
  `bv*[height<=${MAX_DOWNLOAD_HEIGHT}]+ba`,
  `b[height<=${MAX_DOWNLOAD_HEIGHT}]`,
].join('/')
const HLS_DOWNLOAD_FORMAT = [
  `bv*[height<=${MAX_DOWNLOAD_HEIGHT}][protocol^=m3u8]+ba[protocol^=m3u8]`,
  `b[height<=${MAX_DOWNLOAD_HEIGHT}][protocol^=m3u8]`,
].join('/')
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
])

interface YouTubeOptions {
  downloadsPath: string
  maxDuration: number
  providerUrl?: string
  startScanner: (pathId: number) => void
  pushJobs: () => void
  pushQueue: () => void
}

const jobs = new Map<string, YouTubeJob>()
let activeDownloads = 0

export function normalizeYouTubeUrl (input: string): string {
  let url: URL

  try {
    url = new URL(input)
  } catch {
    throw new Error('Enter a valid YouTube video URL')
  }

  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('Only HTTPS YouTube video URLs are supported')
  }

  let videoId = ''
  if (url.hostname.toLowerCase() === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || ''
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v') || ''
  } else {
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)
    videoId = match?.[1] || ''
  }

  if (!VIDEO_ID.test(videoId)) {
    throw new Error('The URL must point to one YouTube video')
  }

  return `https://www.youtube.com/watch?v=${videoId}`
}

export function createYouTubeJob (
  url: string,
  owner: Pick<YouTubeJob, 'roomId' | 'userId' | 'userDisplayName' | 'userDateUpdated'>,
  options: YouTubeOptions,
): YouTubeJob {
  if (activeDownloads >= 2) throw new Error('The YouTube download queue is busy; try again shortly')

  const normalizedUrl = normalizeYouTubeUrl(url)
  const job: YouTubeJob = {
    jobId: randomUUID(),
    ...owner,
    title: 'YouTube video',
    status: 'queued',
    progress: 0,
    message: 'Waiting to download',
  }

  jobs.set(job.jobId, job)
  options.pushJobs()
  activeDownloads++
  void runDownload(job, normalizedUrl, options).finally(() => {
    activeDownloads--
    setTimeout(() => jobs.delete(job.jobId), 30 * 60 * 1000).unref()
  })

  return job
}

export function getYouTubeJob (jobId: string, userId: number): YouTubeJob | undefined {
  const job = jobs.get(jobId)
  return job?.userId === userId ? job : undefined
}

export function getRoomYouTubeJobs (roomId: number): YouTubeJob[] {
  return Array.from(jobs.values()).filter(job => job.roomId === roomId && job.status !== 'complete')
}

async function runDownload (job: YouTubeJob, url: string, options: YouTubeOptions): Promise<void> {
  try {
    fs.mkdirSync(options.downloadsPath, { recursive: true })
    const libraryPath = resolveDownloadLibraryPath(options.downloadsPath)

    job.status = 'downloading'
    job.message = 'Downloading from YouTube'
    options.pushJobs()

    const args = [
      '--no-playlist',
      '--no-overwrites',
      '--newline',
      '--force-ipv4',
      '--js-runtimes', 'node',
      '--extractor-retries', '3',
      '--fragment-retries', '3',
      '--match-filter', `!is_live & duration <= ${options.maxDuration}`,
      '--max-filesize', '2G',
      '--merge-output-format', 'mp4/mkv',
      '--remux-video', 'mp4/mkv',
      '--format', DOWNLOAD_FORMAT,
      '--output', path.join(options.downloadsPath, 'YouTube-%(title).150B-YouTube [%(id)s].%(ext)s'),
      '--progress-template', 'download:progress:%(progress._percent_str)s',
      '--print', 'before_dl:title:%(title)s',
      '--print', 'after_move:filepath:%(filepath)s',
    ]

    if (options.providerUrl) {
      args.push('--extractor-args', 'youtube:player-client=mweb')
      args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${options.providerUrl}`)
    }
    args.push(url)

    try {
      job.file = await spawnYtDlp(args, job, options.pushJobs)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!isRetryableFormatError(message)) throw error

      job.progress = 0
      job.message = 'YouTube rejected the first format; trying an alternate client'
      options.pushJobs()
      const directArgs = argsWithoutProvider(args)

      try {
        job.file = await spawnYtDlp(directArgs, job, options.pushJobs)
      } catch (directError) {
        const directMessage = directError instanceof Error ? directError.message : String(directError)
        if (!/HTTP Error 403|Forbidden/i.test(directMessage)) throw directError

        job.progress = 0
        job.message = 'YouTube rejected the alternate format; retrying with HLS'
        options.pushJobs()
        const hlsArgs = [...directArgs]
        const formatIndex = hlsArgs.indexOf('--format')
        hlsArgs[formatIndex + 1] = HLS_DOWNLOAD_FORMAT
        hlsArgs.splice(hlsArgs.length - 1, 0, '--extractor-args', 'youtube:player-client=web_safari')
        job.file = await spawnYtDlp(hlsArgs, job, options.pushJobs)
      }
    }
    job.status = 'scanning'
    job.progress = 100
    job.message = 'Download complete; scanning the library'
    options.pushJobs()
    options.startScanner(libraryPath.pathId)

    const relPath = path.relative(libraryPath.basePath, job.file).replace(/\\/g, '/')
    const media = await waitForMedia(libraryPath.pathId, relPath)
    Queue.add({ roomId: job.roomId, songId: media.songId, userId: job.userId })
    job.status = 'complete'
    job.message = 'Downloaded and added to the queue.'
    options.pushJobs()
    options.pushQueue()
    log.info('Downloaded %s', job.file)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    job.status = 'error'
    job.progress = null
    job.message = friendlyError(message)
    options.pushJobs()
    setTimeout(() => {
      jobs.delete(job.jobId)
      options.pushJobs()
    }, 10000).unref()
    log.warn('YouTube download failed: %s', message)
  }
}

function isRetryableFormatError (message: string): boolean {
  return /HTTP Error 403|Forbidden|requested format|format.+(?:not available|unavailable|unsupported)/i.test(message)
}

function argsWithoutProvider (args: string[]): string[] {
  const result: string[] = []

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--extractor-args' && /^(?:youtube:player-client=mweb|youtubepot-)/.test(args[i + 1] || '')) {
      i++
      continue
    }
    result.push(args[i])
  }

  return result
}

function resolveDownloadLibraryPath (downloadsPath: string): { pathId: number, basePath: string } {
  const normalized = path.resolve(downloadsPath)
  const prefs = Prefs.get()
  const parents = prefs.paths.result
    .map(pathId => ({ pathId, basePath: path.resolve(prefs.paths.entities[pathId].path) }))
    .filter(({ basePath }) => normalized === basePath || normalized.startsWith(basePath + path.sep))
    .sort((a, b) => b.basePath.length - a.basePath.length)

  if (parents.length) return parents[0]

  return {
    pathId: Prefs.addPath(normalized, {
      prefs: {
        isVideoKeyingEnabled: false,
        isWatchingEnabled: false,
      },
      isManagedDownloadPath: true,
    }),
    basePath: normalized,
  }
}

async function spawnYtDlp (args: string[], job: YouTubeJob, pushJobs: () => void): Promise<string> {
  let finalPath = ''
  let lastPush = 0
  let lineBuffer = ''
  const handleStdout = (chunk: Buffer) => {
    lineBuffer += chunk.toString()
    const lines = lineBuffer.split(/\r?\n/)
    lineBuffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('progress:')) {
        const pct = parseFloat(line.substring('progress:'.length).replace('%', '').trim())
        if (Number.isFinite(pct)) {
          job.progress = Math.max(0, Math.min(100, pct))
          if (Date.now() - lastPush >= 500) {
            lastPush = Date.now()
            pushJobs()
          }
        }
      } else if (line.startsWith('title:')) {
        job.title = line.substring('title:'.length).trim() || job.title
        pushJobs()
      } else if (line.startsWith('filepath:')) {
        finalPath = line.substring('filepath:'.length).trim()
      }
    }
  }

  try {
    const { stdout } = await runProcessText('yt-dlp', args, {
      timeoutMs: 30 * 60 * 1000,
      maxStdoutBytes: 16000,
      maxStderrBytes: 16000,
      onStdout: handleStdout,
    })
    return finalPath || stdout.trim().split(/\r?\n/).pop() || ''
  } catch (error) {
    if (error instanceof ProcessExecutionError) {
      if (/timed out/.test(error.message)) throw new Error('YouTube download timed out')
      throw new Error(error.stderr.toString().trim() || error.message, { cause: error })
    }
    throw error
  }
}

async function waitForMedia (pathId: number, relPath: string): Promise<{ songId: number }> {
  const deadline = Date.now() + 10 * 60 * 1000

  while (Date.now() < deadline) {
    const result = Media.search({ pathId, relPath })
    if (result.result.length) return result.entities[result.result[0]]
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  throw new Error('The download finished, but the library scan did not complete in time')
}

function friendlyError (message: string): string {
  if (/sign in|login|age.?restrict|members.?only|private video/i.test(message)) {
    return 'This video requires a YouTube account and is not supported. Choose a public video.'
  }
  if (/duration|longer than/i.test(message)) return 'This video is longer than the configured download limit.'
  if (/live event|is_live/i.test(message)) return 'Live YouTube videos are not supported.'
  if (/requested format|not available|unavailable/i.test(message)) return 'This YouTube video is unavailable or has no supported format.'
  if (/ENOENT.*yt-dlp|spawn yt-dlp/i.test(message)) return 'YouTube downloading is not installed on this server.'
  return `YouTube download failed: ${message.split(/\r?\n/).pop()?.slice(0, 300) || 'unknown error'}`
}
