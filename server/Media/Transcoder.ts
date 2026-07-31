import childProcess from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import getLogger from '../lib/Log.js'

const log = getLogger('Transcoder')
const pending = new Map<string, Promise<string>>()
let pruneQueue = Promise.resolve()
const transcodeVersion = 2

const cacheDir = process.env.KES_PATH_TRANSCODE
  || path.join(os.tmpdir(), 'karaoke-eternal-transcode')
const ffmpegPath = process.env.KES_PATH_FFMPEG || 'ffmpeg'
const maxCacheBytes = Math.max(
  1,
  parseFloat(process.env.KES_TRANSCODE_MAX_SIZE_GB || '8') || 8,
) * 1024 ** 3

/**
 * Return an H.264/AAC MP4 for browser playback. Results are cached for the
 * lifetime of the source file and concurrent requests share one FFmpeg job.
 */
export async function getBrowserVideo (source: string, mediaId: number): Promise<string> {
  const stats = await fsPromises.stat(source)
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${transcodeVersion}\0${source}\0${stats.size}\0${stats.mtimeMs}`)
    .digest('hex')
    .slice(0, 16)
  const output = path.join(cacheDir, `${mediaId}-${fingerprint}.mp4`)

  if (await exists(output)) {
    const now = new Date()
    await fsPromises.utimes(output, now, now)
    await pruneCache(output)
    return output
  }

  const current = pending.get(output)
  if (current) return current

  const job = transcode(source, output, mediaId)
    .finally(() => pending.delete(output))
  pending.set(output, job)
  return job
}

async function transcode (source: string, output: string, mediaId: number): Promise<string> {
  await fsPromises.mkdir(cacheDir, { recursive: true })

  // Remove stale cached versions for this media record.
  const entries = await fsPromises.readdir(cacheDir)
  await Promise.all(entries
    .filter(file => file.startsWith(`${mediaId}-`))
    .map(file => fsPromises.rm(path.join(cacheDir, file), { force: true })))

  const partial = output.replace(/\.mp4$/, '.partial.mp4')
  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', source,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', process.env.KES_TRANSCODE_PRESET || 'veryfast',
    '-crf', process.env.KES_TRANSCODE_CRF || '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', process.env.KES_TRANSCODE_AUDIO_BITRATE || '192k',
    '-movflags', '+faststart',
    partial,
  ]

  log.info('Transcoding mediaId=%s: %s', mediaId, source)

  try {
    await run(ffmpegPath, args)
    await fsPromises.rename(partial, output)
    await pruneCache(output)
    log.info('Transcode ready mediaId=%s: %s', mediaId, output)
    return output
  } catch (err) {
    await fsPromises.rm(partial, { force: true })
    throw err
  }
}

function run (command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = childProcess.spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''

    process.stderr.setEncoding('utf8')
    process.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000)
    })

    process.on('error', (err) => {
      reject(new Error(`Could not start FFmpeg (${command}): ${err.message}`))
    })
    process.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.trim()}`))
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

/**
 * Serialize pruning so simultaneous transcodes cannot race while choosing the
 * least-recently-used files. The file used by the current request is retained.
 */
async function pruneCache (keep: string): Promise<void> {
  const prune = async () => {
    const entries = await fsPromises.readdir(cacheDir, { withFileTypes: true })
    const files = await Promise.all(entries
      .filter(entry => entry.isFile() && /^\d+-[a-f0-9]+\.mp4$/.test(entry.name))
      .map(async (entry) => {
        const file = path.join(cacheDir, entry.name)
        const stats = await fsPromises.stat(file)
        return { file, mtimeMs: stats.mtimeMs, size: stats.size }
      }))

    const removable = files
      .filter(entry => entry.file !== keep)
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
    let totalBytes = files.reduce((total, entry) => total + entry.size, 0)
    const remove = []

    for (const entry of removable) {
      if (totalBytes <= maxCacheBytes) break
      remove.push(entry)
      totalBytes -= entry.size
    }

    await Promise.all(remove
      .map(async ({ file }) => {
        await fsPromises.rm(file, { force: true })
        log.verbose('Removed old transcode cache file: %s', file)
      }))
  }

  const queued = pruneQueue.then(prune, prune)
  pruneQueue = queued.catch(() => undefined)
  return queued
}
