import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import getLogger from '../lib/Log.js'

interface BrowserMediaBundle {
  video: string
  audio: string[]
}

interface BundleManifest {
  video: string
  audio: string[]
}

const log = getLogger('Transcoder')
const pending = new Map<string, Promise<BrowserMediaBundle>>()
let pruneQueue = Promise.resolve()
const transcodeVersion = 3

const cacheDir = process.env.KES_PATH_TRANSCODE
  || path.join(os.tmpdir(), 'karaoke-eternal-transcode')
const ffmpegPath = process.env.KES_PATH_FFMPEG || 'ffmpeg'
const ffprobePath = process.env.KES_PATH_FFPROBE || 'ffprobe'
const maxCacheBytes = Math.max(
  1,
  parseFloat(process.env.KES_TRANSCODE_MAX_SIZE_GB || '8') || 8,
) * 1024 ** 3

/**
 * Return a browser-compatible bundle with silent H.264 video and one AAC file
 * per source audio stream. Concurrent requests share one preparation job.
 */
export async function getBrowserMedia (source: string, mediaId: number): Promise<BrowserMediaBundle> {
  const stats = await fsPromises.stat(source)
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${transcodeVersion}\0${source}\0${stats.size}\0${stats.mtimeMs}`)
    .digest('hex')
    .slice(0, 16)
  const output = path.join(cacheDir, `${mediaId}-${fingerprint}`)
  const manifestFile = path.join(output, 'manifest.json')

  if (await exists(manifestFile)) {
    const now = new Date()
    await fsPromises.utimes(output, now, now)
    await pruneCache(output)
    return readBundle(output)
  }

  const current = pending.get(output)
  if (current) return current

  const job = transcode(source, output, mediaId)
    .finally(() => pending.delete(output))
  pending.set(output, job)
  return job
}

async function transcode (source: string, output: string, mediaId: number): Promise<BrowserMediaBundle> {
  await fsPromises.mkdir(cacheDir, { recursive: true })

  // Remove stale cache versions for this media record, including the legacy
  // single-MP4 cache format.
  const entries = await fsPromises.readdir(cacheDir)
  await Promise.all(entries
    .filter(file => file.startsWith(`${mediaId}-`))
    .map(file => fsPromises.rm(path.join(cacheDir, file), { recursive: true, force: true })))

  const partial = `${output}.partial`
  await fsPromises.mkdir(partial, { recursive: true })

  log.info('Preparing browser media bundle mediaId=%s: %s', mediaId, source)

  try {
    const audioCount = await getAudioTrackCount(source)
    if (audioCount === 0) throw new Error('Video contains no audio tracks')

    const videoName = 'video.mp4'
    const audioNames = Array.from({ length: audioCount }, (_, i) => `audio-${i + 1}.m4a`)

    await Promise.all([
      run(ffmpegPath, [
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
      ]),
      ...audioNames.map((name, i) => run(ffmpegPath, [
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
    ])

    const manifest: BundleManifest = {
      video: videoName,
      audio: audioNames,
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

async function getAudioTrackCount (source: string): Promise<number> {
  const stdout = await runCapture(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    source,
  ])
  return stdout.split(/\r?\n/).filter(Boolean).length
}

async function readBundle (directory: string): Promise<BrowserMediaBundle> {
  const manifest = JSON.parse(
    await fsPromises.readFile(path.join(directory, 'manifest.json'), 'utf8'),
  ) as BundleManifest
  return resolveBundle(directory, manifest)
}

function resolveBundle (directory: string, manifest: BundleManifest): BrowserMediaBundle {
  return {
    video: path.join(directory, manifest.video),
    audio: manifest.audio.map(file => path.join(directory, file)),
  }
}

function run (command: string, args: string[]): Promise<void> {
  return spawn(command, args).then(() => undefined)
}

function runCapture (command: string, args: string[]): Promise<string> {
  return spawn(command, args)
}

function spawn (command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = childProcess.spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    process.stdout.setEncoding('utf8')
    process.stderr.setEncoding('utf8')
    process.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    process.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000)
    })

    process.on('error', (err) => {
      reject(new Error(`Could not start ${command}: ${err.message}`))
    })
    process.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`))
    })
  })
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
      .filter(entry => entry.isDirectory() && /^\d+-[a-f0-9]+$/.test(entry.name))
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
