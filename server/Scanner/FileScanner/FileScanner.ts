import path from 'path'
import getLogger from '../../lib/Log.js'
import { getExt } from '../../lib/util.js'
import getFiles from './getFiles.js'
import getConfig from './getConfig.js'
import Media from '../../Media/Media.js'
import Scanner from '../Scanner.js'
import IPC from '../../lib/IPCBridge.js'
import fileTypes from '../../Media/fileTypes.js'
import MetadataWorkerPool, { MetadataResult } from './MetadataWorkerPool.js'
import { LIBRARY_MATCH_SONG, MEDIA_ADD, MEDIA_REMOVE, MEDIA_UPDATE } from '../../../shared/actionTypes.js'
const log = getLogger('FileScanner')

const searchExts = Object.keys(fileTypes).filter(ext => fileTypes[ext].scan !== false)

class FileScanner extends Scanner {
  paths: any
  workerCount: number
  filenameFormat: string

  constructor (prefs, qStats, workerCount = 4, filenameFormat = '') {
    super(qStats)
    this.paths = prefs.paths
    this.workerCount = workerCount
    this.filenameFormat = filenameFormat
  }

  async scan (pathId) {
    const dir = this.paths.entities[pathId]?.path
    const validMediaIds = []
    const stats = { new: 0, removed: 0, existing: 0 }
    let files // { file, stats }[]

    if (!dir) {
      log.error('invalid pathId: %s', pathId)
      return stats
    }

    log.info('Searching: %s', dir)
    this.emitStatus(`Searching: ${dir}`, 0)

    try {
      files = getFiles(dir, file => searchExts.includes(getExt(file)))

      log.info('  => found %s files with valid extensions %s',
        files.length.toLocaleString(),
        JSON.stringify(searchExts),
      )
    } catch (err) {
      log.error(`  => ${err.message} (path offline)`)
      return stats
    }

    log.info('Starting metadata pool with %s workers', this.workerCount)
    const pool = new MetadataWorkerPool(this.workerCount, this.filenameFormat)
    const parserConfigs = new Map<string, Record<string, unknown> | undefined>()
    const pending = new Map<number, Promise<{ result?: MetadataResult, error?: Error }>>()
    const windowSize = this.workerCount * 4
    const schedule = (index: number) => {
      if (index >= files.length) return
      const file = files[index].file
      const curDir = path.dirname(file)

      if (!parserConfigs.has(curDir)) parserConfigs.set(curDir, getConfig(curDir, dir))
      pending.set(index, pool.run({ file, parserConfig: parserConfigs.get(curDir) })
        .then(result => ({ result }))
        .catch(error => ({ error })))
    }

    try {
      for (let i = 0; i < Math.min(windowSize, files.length); i++) schedule(i)

      for (let i = 0; i < files.length; i++) {
        const extracted = await pending.get(i)
        pending.delete(i)
        schedule(i + windowSize)

        log.info('[%s/%s] %s', i + 1, files.length, files[i].file)
        this.emitStatus(`Scanning (${i + 1} of ${files.length}; ${this.workerCount} workers)`, (i + 1) / files.length)

        try {
          if (!extracted?.result) throw extracted?.error || new Error('metadata worker returned no result')
          const res = await this.process(files[i].file, pathId, extracted.result)
          validMediaIds.push(res.mediaId)

          if (res.isNew) stats.new++
          else stats.existing++
        } catch (err) {
          log.warn(`  => ${err.message}`)
        }

        if (this.isCanceling) {
          this.emitStatus('Stopped', 100, false)
          return stats
        }
      }
    } finally {
      await pool.close()
    }

    log.info('Scanned %s valid media files', validMediaIds.length.toLocaleString())
    log.info('Searching for invalid media entries')

    const numRemoved = await this.removeInvalid(pathId, validMediaIds)
    stats.removed = numRemoved
    log.info(`Removed ${numRemoved} invalid media entries`)

    return stats
  }

  async process (file, pathId, metadata: MetadataResult) {
    log.verbose('  => duration: %s:%s',
      Math.floor(metadata.duration / 60),
      Math.round(metadata.duration % 60).toString().padStart(2, '0'),
    )

    // get artistId and songId
    const match = await (IPC as any).req({ type: LIBRARY_MATCH_SONG, payload: metadata.parsed })

    const media = {
      songId: match.songId,
      pathId,
      // normalize relPath to forward slashes with no leading slash
      relPath: file.substring(this.paths.entities[pathId].path.length).replace(/\\/g, '/').replace(/^\//, ''),
      duration: Math.round(metadata.duration),
      rgTrackGain: metadata.rgTrackGain,
      rgTrackPeak: metadata.rgTrackPeak,
    }

    // file already in database?
    const res = Media.search({
      pathId,
      relPath: media.relPath,
    })

    log.verbose('  => %s db result(s)', res.result.length)

    if (res.result.length) {
      const row = res.entities[res.result[0]]
      const diff = {}

      // did anything change?
      Object.keys(media).forEach((key) => {
        if (media[key] !== row[key]) diff[key] = media[key]
      })

      if (Object.keys(diff).length) {
        await (IPC as any).req({
          type: MEDIA_UPDATE,
          payload: {
            mediaId: row.mediaId,
            dateUpdated: Math.round(new Date().getTime() / 1000), // seconds
            ...diff,
          },
        })

        log.info('  => updated: %s', Object.keys(diff).join(', '))
      } else {
        log.info('  => ok')
      }

      return { mediaId: row.mediaId, isNew: false }
    } // end if

    // new media
    ;(media as any).dateAdded = Math.round(new Date().getTime() / 1000) // seconds
    log.info('  => new: %s', JSON.stringify(match))

    return {
      mediaId: await (IPC as any).req({ type: MEDIA_ADD, payload: media }),
      isNew: true,
    }
  }

  async removeInvalid (pathId, validMediaIds = []) {
    const res = Media.search({ pathId })
    const invalid = res.result.filter(mediaId => !validMediaIds.includes(mediaId))

    if (invalid.length) {
      await (IPC as any).req({ type: MEDIA_REMOVE, payload: invalid })
    }

    return invalid.length
  }
}

export default FileScanner
