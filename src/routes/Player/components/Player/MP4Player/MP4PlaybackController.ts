import { BROWSER_MEDIA_VERSION, type SourceMediaInfo } from 'shared/media'
import { supportsSourceAudio, supportsSourceVideo } from '../../../lib/mediaSupport'

export interface MP4PlaybackProps {
  audioTrack: 0 | 1
  isPlaying: boolean
  mediaId: number
  onError(error: string): void
  onLoad(): void
  onPlay(): void
  onStatus(status: { position?: number, duration?: number, audioTrackCount?: number }): void
}

interface ControllerOptions {
  combinedPlayback?: boolean
  onPlaybackStarted?: () => void
  onStopped?: () => void
}

const mediaVersion = `&v=${BROWSER_MEDIA_VERSION}`
const audioFormat = /Web0S|webOS|NetCast/i.test(navigator.userAgent) ? '&audioFormat=aac' : ''

export class MP4PlaybackController {
  #audio: HTMLAudioElement
  #audioReady = false
  #getProps: () => MP4PlaybackProps
  #options: ControllerOptions
  #pendingPosition = 0
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
    getProps: () => MP4PlaybackProps,
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
    this.#videoReady = false
    this.#audioReady = false
    this.#sourceInfo = undefined
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
      if (!this.#videoReady || !this.#audioReady) return
      this.#video.currentTime = this.#audio.currentTime
      const request = ++this.#playRequest
      Promise.all([this.#video.play(), this.#audio.play()])
        .catch(error => this.#handlePlayError(error, request))
    } else this.stop()
  }

  stop (): void {
    this.#playRequest++
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
    this.#getProps().onPlay()
    this.#options.onPlaybackStarted?.()
  }

  handleTimeUpdate = (): void => {
    const position = this.#audio.currentTime
    if (Math.abs(this.#video.currentTime - position) > 0.2) this.#video.currentTime = position
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
    if (request !== this.#playRequest || isPlayInterruption(error)) return
    this.#getProps().onError(error instanceof Error ? error.message : String(error))
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
