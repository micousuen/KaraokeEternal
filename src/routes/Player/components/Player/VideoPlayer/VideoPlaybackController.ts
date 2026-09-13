import { BROWSER_MEDIA_VERSION, type SourceMediaInfo } from 'shared/media'
import { supportsSourceAudio, supportsSourceVideo } from '../../../lib/mediaSupport'

export interface VideoPlaybackProps {
  audioTrack: 0 | 1
  isPlaying: boolean
  mediaId: number
  onError(error: string): void
  onLoad(): void
  onPlay(): void
  onStatus(status: { position?: number, duration?: number, audioTrackCount?: number }): void
}

export interface VideoPlaybackUpdateProps extends VideoPlaybackProps {
  mediaKey: number
  mediaReplayKey?: number
  mediaSeekKey?: number
  seekPosition: number
}

interface ControllerOptions {
  combinedPlayback?: boolean
  onPlaybackStarted?: () => void
  onStopped?: () => void
}

const mediaVersion = `&v=${BROWSER_MEDIA_VERSION}`
const audioFormat = /Web0S|webOS|NetCast/i.test(navigator.userAgent) ? '&audioFormat=aac' : ''

// Audio is the playback master; the muted video follows it. Phone hardware
// decodes video slowly, so a tight seek threshold causes a seek-storm (the
// video visibly flickers in quick bursts). Small drift converges invisibly
// through playback-rate nudges; only large drift hard-seeks, and even then
// only after the previous seek had time to settle.
const SYNC_RATE_THRESHOLD = 0.05
const SYNC_STRONG_DRIFT = 0.25
const SYNC_SEEK_THRESHOLD = 0.5
const SEEK_SETTLE_MS = 750

export class VideoPlaybackController {
  #audio: HTMLAudioElement
  #audioReady = false
  #getProps: () => VideoPlaybackProps
  #lastSeekAt = 0
  #options: ControllerOptions
  #pendingPosition = 0
  #playRetries = 0
  #playRequest = 0
  #sourceInfo: SourceMediaInfo | undefined
  #sourceRequest = 0
  #usingSourceAudio = false
  #usingSourceVideo = false
  #video: HTMLVideoElement
  #videoReady = false

  constructor (
    video: HTMLVideoElement,
    audio: HTMLAudioElement,
    getProps: () => VideoPlaybackProps,
    options: ControllerOptions = {},
  ) {
    this.#video = video
    this.#audio = audio
    this.#getProps = getProps
    this.#options = options
  }

  updateSources (): void {
    this.#options.onStopped?.()
    this.#pendingPosition = 0
    this.#playRequest++
    this.#playRetries = 0
    this.#lastSeekAt = 0
    this.#videoReady = false
    this.#audioReady = false
    this.#sourceInfo = undefined
    this.#video.playbackRate = 1
    this.#video.pause()
    this.#audio.pause()
    if (this.#options.combinedPlayback) {
      this.updateCombinedSource()
      void this.#fetchSourceInfo().catch(error => this.#getProps().onError(error.message))
      return
    }

    const request = ++this.#sourceRequest
    void this.#fetchSourceInfo()
      .then((info): undefined => {
        if (request !== this.#sourceRequest) return undefined
        this.#sourceInfo = info
        this.#usingSourceVideo = supportsSourceVideo(this.#video, info)
        this.#usingSourceAudio = supportsSourceAudio(this.#audio, info.audioTracks[this.#getProps().audioTrack])
        this.#videoReady = false
        this.#video.src = this.#mediaUrl(this.#usingSourceVideo ? 'sourceVideo' : 'video')
        this.#video.load()
        this.updateAudioSource()
        return undefined
      })
      .catch((error): undefined => {
        if (request !== this.#sourceRequest) return undefined
        this.#usingSourceVideo = false
        this.#usingSourceAudio = false
        this.#videoReady = false
        this.#video.src = this.#mediaUrl('video')
        this.#video.load()
        this.updateAudioSource()
        this.#getProps().onError(error.message)
        return undefined
      })
  }

  updateCombinedSource (position = 0): void {
    this.#video.pause()
    this.#playRequest++
    this.#videoReady = false
    this.#pendingPosition = position
    this.#video.src = this.#mediaUrl('videoCombined', `&audioTrack=${this.#getProps().audioTrack}`)
    this.#video.load()
  }

  updateAudioSource (position = 0, preferSource = true): void {
    this.#options.onStopped?.()
    this.#video.pause()
    this.#audio.pause()
    this.#playRequest++
    this.#audioReady = false
    this.#pendingPosition = position
    this.#usingSourceAudio = preferSource && !!this.#sourceInfo
      && supportsSourceAudio(this.#audio, this.#sourceInfo.audioTracks[this.#getProps().audioTrack])
    const type = this.#usingSourceAudio ? 'sourceAudio' : 'videoAudio'
    const format = this.#usingSourceAudio ? '' : audioFormat
    this.#audio.src = this.#mediaUrl(type, `&audioTrack=${this.#getProps().audioTrack}${format}`)
    this.#audio.load()
  }

  updateIsPlaying (): void {
    const props = this.#getProps()
    if (this.#options.combinedPlayback) {
      if (props.isPlaying) {
        if (!this.#videoReady) return
        const request = ++this.#playRequest
        this.#video.play().catch(error => this.#handlePlayError(error, request))
      } else this.stop()
      return
    }

    if (props.isPlaying) {
      if (!this.#isReadyToPlay()) return
      // An unnecessary pre-play seek shows as a black flash on phones.
      const position = this.#audio.currentTime
      if (Math.abs(this.#video.currentTime - position) > 0.1) this.setCurrentTime(position)
      const request = ++this.#playRequest
      Promise.all([this.#video.play(), this.#audio.play()])
        .catch(error => this.#handlePlayError(error, request))
    } else this.stop()
  }

  stop (): void {
    this.#playRequest++
    this.#video.playbackRate = 1
    this.#video.pause()
    this.#audio.pause()
    this.#options.onStopped?.()
  }

  dispose (): void {
    this.stop()
    this.#sourceRequest++
    this.#video.removeAttribute('src')
    this.#audio.removeAttribute('src')
    this.#video.load()
    this.#audio.load()
  }

  setCurrentTime (position: number): void {
    this.#lastSeekAt = Date.now()
    this.#video.playbackRate = 1
    this.#video.currentTime = position
    this.#audio.currentTime = position
  }

  handleAudioMetadata = (): void => {
    this.#getProps().onStatus({ duration: this.#audio.duration })
    if (this.#pendingPosition <= 0) return
    this.setCurrentTime(Math.min(this.#pendingPosition, this.#audio.duration))
    this.#pendingPosition = 0
  }

  handleVideoMetadata = (): void => {
    this.#getProps().onStatus({ duration: this.#video.duration })
    if (this.#pendingPosition <= 0) return
    this.#video.currentTime = Math.min(this.#pendingPosition, this.#video.duration)
    this.#pendingPosition = 0
  }

  handleVideoCanPlay = (): void => {
    this.#videoReady = true
    this.updateIsPlaying()
  }

  handleAudioCanPlay = (): void => {
    this.#audioReady = true
    this.updateIsPlaying()
  }

  handleVideoError = (): void => {
    if (this.#usingSourceVideo) {
      const position = this.#audio.currentTime || this.#video.currentTime || 0
      this.#usingSourceVideo = false
      this.#playRequest++
      this.#videoReady = false
      this.#video.pause()
      this.#audio.pause()
      this.#pendingPosition = position
      this.#video.src = this.#mediaUrl('video')
      this.#video.load()
      return
    }
    this.#reportMediaError(this.#video, 'video')
  }

  handleAudioError = (): void => {
    if (this.#usingSourceAudio) {
      this.#usingSourceAudio = false
      this.#playRequest++
      this.#audioReady = false
      this.updateAudioSource(this.#audio.currentTime || 0, false)
      return
    }
    this.#reportMediaError(this.#audio, 'audio')
  }

  handlePlay = (): void => {
    this.#playRetries = 0
    this.#getProps().onPlay()
    this.#options.onPlaybackStarted?.()
  }

  handleTimeUpdate = (): void => {
    const position = this.#audio.currentTime
    const drift = position - this.#video.currentTime
    const behind = Math.abs(drift)
    if (behind > SYNC_SEEK_THRESHOLD && Date.now() - this.#lastSeekAt > SEEK_SETTLE_MS) {
      this.#lastSeekAt = Date.now()
      this.#video.playbackRate = 1
      this.#video.currentTime = position
    } else if (behind > SYNC_RATE_THRESHOLD) {
      // Video-only correction; the audible track is untouched.
      const strong = behind > SYNC_STRONG_DRIFT
      const rate = drift > 0 ? (strong ? 1.1 : 1.05) : (strong ? 0.9 : 0.95)
      if (this.#video.playbackRate !== rate) this.#video.playbackRate = rate
    } else if (this.#video.playbackRate !== 1) {
      this.#video.playbackRate = 1
    }
    this.#getProps().onStatus({ position })
  }

  handleVideoTimeUpdate = (): void => {
    this.#getProps().onStatus({ position: this.#video.currentTime })
  }

  async #fetchSourceInfo (): Promise<SourceMediaInfo> {
    const response = await fetch(this.#mediaUrl('videoInfo'))
    if (!response.ok) throw new Error(await response.text())
    const info = await response.json() as SourceMediaInfo
    this.#getProps().onStatus({ audioTrackCount: info.audioTrackCount })
    return info
  }

  #mediaUrl (type: string, query = ''): string {
    return `${document.baseURI}api/media/${this.#getProps().mediaId}?type=${type}${query}${mediaVersion}`
  }

  #handlePlayError (error: unknown, request: number): void {
    if (request !== this.#playRequest) return
    if (isPlayInterruption(error)) {
      // A load or pause interrupted the request. A follow-up event usually
      // restarts playback, but when none arrives the elements stay idle —
      // a permanent black screen on phones until the page is refreshed.
      const retryRequest = this.#playRequest
      setTimeout(() => {
        if (retryRequest !== this.#playRequest) return
        if (!this.#getProps().isPlaying || !this.#isReadyToPlay()) return
        if (++this.#playRetries > 3) return
        this.updateIsPlaying()
      }, 250)
      return
    }
    this.#getProps().onError(error instanceof Error ? error.message : String(error))
  }

  #isReadyToPlay (): boolean {
    return this.#options.combinedPlayback
      ? this.#videoReady
      : this.#videoReady && this.#audioReady
  }

  #reportMediaError (element: HTMLMediaElement, kind: 'audio' | 'video'): void {
    const error = element.error
    this.#getProps().onError(error ? `${error.message} (${kind} code ${error.code})` : `Unknown ${kind} playback error`)
  }
}

export function isPlayInterruption (error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'AbortError'
    || /play\(\) request was interrupted|play request was interrupted/i.test(error.message)
  )
}

/** Apply prop transitions consistently for normal and chroma-keyed players. */
export function updatePlaybackController (
  controller: VideoPlaybackController,
  previous: VideoPlaybackUpdateProps,
  current: VideoPlaybackUpdateProps,
  position: number,
  combinedPlayback = false,
): boolean {
  if (previous.mediaKey !== current.mediaKey) {
    controller.updateSources()
    return true
  }
  if (previous.audioTrack !== current.audioTrack) {
    if (combinedPlayback) controller.updateCombinedSource(position)
    else controller.updateAudioSource(position)
    return true
  }
  if (previous.mediaReplayKey !== current.mediaReplayKey) {
    controller.setCurrentTime(0)
    return true
  }
  if (previous.mediaSeekKey !== current.mediaSeekKey) {
    controller.setCurrentTime(current.seekPosition)
    return true
  }
  if (previous.isPlaying !== current.isPlaying) controller.updateIsPlaying()
  return false
}
