import React from 'react'
import { BROWSER_MEDIA_VERSION } from 'shared/media'
import { type SourceMediaInfo, supportsSourceAudio, supportsSourceVideo } from '../../../lib/mediaSupport'
import styles from './MP4Player.css'

const mediaVersion = `&v=${BROWSER_MEDIA_VERSION}`
const audioFormat = /Web0S|webOS|NetCast/i.test(navigator.userAgent) ? '&audioFormat=aac' : ''
const isWebOs = /Web0S|webOS|NetCast/i.test(navigator.userAgent)
const HARD_SYNC_THRESHOLD = 1
const SOFT_SYNC_THRESHOLD = 0.08
const MAX_SYNC_RATE_ADJUSTMENT = 0.03

interface MP4PlayerProps {
  audioTrack: 0 | 1
  isPlaying: boolean
  mediaId: number
  mediaKey: number
  mediaReplayKey?: number
  mediaSeekKey?: number
  seekPosition: number
  width: number
  height: number
  onAudioElement(audio: HTMLAudioElement): void
  // media events
  onEnd(): void
  onError(error: string): void
  onLoad(): void
  onPlay(): void
  onStatus(status: { position?: number, duration?: number, audioTrackCount?: number }): void
}

class MP4Player extends React.Component<MP4PlayerProps> {
  video = React.createRef<HTMLVideoElement>()
  audio = React.createRef<HTMLAudioElement>()
  pendingPosition = 0
  sourceInfo: SourceMediaInfo | undefined
  usingSourceVideo = false
  usingSourceAudio = false
  sourceRequest = 0
  playRequest = 0
  videoReady = false
  audioReady = false

  componentDidMount () {
    this.props.onAudioElement(isWebOs ? this.video.current as HTMLAudioElement : this.audio.current)
    this.updateSources()
  }

  componentDidUpdate (prevProps: MP4PlayerProps) {
    if (prevProps.mediaKey !== this.props.mediaKey) {
      this.updateSources()
      return
    }

    if (prevProps.audioTrack !== this.props.audioTrack) {
      if (isWebOs) this.updateWebOsSource(this.video.current?.currentTime || 0)
      else this.updateAudioSource(this.audio.current?.currentTime || 0)
      return
    }

    if (prevProps.mediaReplayKey !== this.props.mediaReplayKey) {
      this.setCurrentTime(0)
      return
    }

    if (prevProps.mediaSeekKey !== this.props.mediaSeekKey) {
      this.setCurrentTime(this.props.seekPosition)
      return
    }

    if (prevProps.isPlaying !== this.props.isPlaying) {
      this.updateIsPlaying()
    }
  }

  render () {
    const { width, height } = this.props

    return (
      <>
        <video
          className={styles.video}
          muted={!isWebOs}
          preload='auto'
          width={width}
          height={height}
          onError={this.handleVideoError}
          onCanPlay={this.handleVideoCanPlay}
          onEnded={isWebOs ? this.props.onEnd : undefined}
          onLoadStart={isWebOs ? this.props.onLoad : undefined}
          onLoadedMetadata={isWebOs ? this.handleVideoMetadata : undefined}
          onPlay={isWebOs ? this.handlePlay : undefined}
          onTimeUpdate={isWebOs ? this.handleVideoTimeUpdate : undefined}
          ref={this.video}
        />
        <audio
          preload='auto'
          onCanPlay={this.handleAudioCanPlay}
          onEnded={this.props.onEnd}
          onError={this.handleAudioError}
          onLoadStart={this.props.onLoad}
          onLoadedMetadata={this.handleAudioMetadata}
          onPlay={this.handlePlay}
          onTimeUpdate={this.handleTimeUpdate}
          ref={this.audio}
        />
      </>
    )
  }

  updateSources = () => {
    if (!this.video.current || !this.audio.current) return

    this.pendingPosition = 0
    this.playRequest++
    this.videoReady = false
    this.audioReady = false
    this.video.current.pause()
    this.video.current.playbackRate = 1
    this.audio.current.pause()
    if (isWebOs) {
      this.updateWebOsSource()
      void this.fetchSourceInfo().catch(err => this.props.onError(err.message))
      return
    }

    const request = ++this.sourceRequest
    void this.fetchSourceInfo()
      .then((info): undefined => {
        if (request !== this.sourceRequest || !this.video.current || !this.audio.current) return undefined
        this.sourceInfo = info
        this.usingSourceVideo = supportsSourceVideo(this.video.current, info)
        this.usingSourceAudio = supportsSourceAudio(this.audio.current, info.audioTracks[this.props.audioTrack])
        this.videoReady = false
        this.video.current.src = `${document.baseURI}api/media/${this.props.mediaId}?type=${this.usingSourceVideo ? 'sourceVideo' : 'video'}${mediaVersion}`
        this.video.current.load()
        this.updateAudioSource()
        return undefined
      })
      .catch((err): undefined => {
        if (request !== this.sourceRequest || !this.video.current) return undefined
        this.usingSourceVideo = false
        this.usingSourceAudio = false
        this.videoReady = false
        this.video.current.src = `${document.baseURI}api/media/${this.props.mediaId}?type=video${mediaVersion}`
        this.video.current.load()
        this.updateAudioSource()
        this.props.onError(err.message)
        return undefined
      })
  }

  fetchSourceInfo = async (): Promise<SourceMediaInfo> => {
    const response = await fetch(`${document.baseURI}api/media/${this.props.mediaId}?type=videoInfo${mediaVersion}`)
    if (!response.ok) throw new Error(await response.text())
    const info = await response.json() as SourceMediaInfo
    this.props.onStatus({ audioTrackCount: info.audioTrackCount })
    return info
  }

  updateWebOsSource = (position = 0) => {
    if (!this.video.current) return
    this.video.current.pause()
    this.playRequest++
    this.videoReady = false
    this.pendingPosition = position
    this.video.current.src = `${document.baseURI}api/media/${this.props.mediaId}?type=videoCombined&audioTrack=${this.props.audioTrack}${mediaVersion}`
    this.video.current.load()
  }

  updateAudioSource = (position = 0, preferSource = true) => {
    if (!this.audio.current) return

    this.video.current?.pause()
    if (this.video.current) this.video.current.playbackRate = 1
    this.audio.current.pause()
    this.playRequest++
    this.audioReady = false
    this.pendingPosition = position
    this.usingSourceAudio = preferSource && !!this.sourceInfo
      && supportsSourceAudio(this.audio.current, this.sourceInfo.audioTracks[this.props.audioTrack])
    this.audio.current.src = `${document.baseURI}api/media/${this.props.mediaId}?type=${this.usingSourceAudio ? 'sourceAudio' : 'videoAudio'}&audioTrack=${this.props.audioTrack}${this.usingSourceAudio ? '' : audioFormat}${mediaVersion}`
    this.audio.current.load()
  }

  updateIsPlaying = () => {
    if (!this.video.current || !this.audio.current) return

    if (isWebOs) {
      if (this.props.isPlaying) {
        if (!this.videoReady) return
        const request = ++this.playRequest
        this.video.current.play().catch((err) => {
          if (request === this.playRequest && !isPlayInterruption(err)) this.props.onError(err.message)
        })
      } else {
        this.playRequest++
        this.video.current.pause()
      }
      return
    }

    if (this.props.isPlaying) {
      if (!this.videoReady || !this.audioReady) return
      this.video.current.playbackRate = 1
      this.video.current.currentTime = this.audio.current.currentTime
      const request = ++this.playRequest
      Promise.all([this.video.current.play(), this.audio.current.play()])
        .catch((err) => {
          if (request === this.playRequest && !isPlayInterruption(err)) this.props.onError(err.message)
        })
    } else {
      this.playRequest++
      this.video.current.pause()
      this.audio.current.pause()
    }
  }

  setCurrentTime = (position: number) => {
    if (this.video.current) {
      this.video.current.playbackRate = 1
      this.video.current.currentTime = position
    }
    if (this.audio.current) this.audio.current.currentTime = position
  }

  handleAudioMetadata = () => {
    if (!this.audio.current) return
    this.props.onStatus({ duration: this.audio.current.duration })
    if (this.pendingPosition <= 0) return
    this.setCurrentTime(Math.min(this.pendingPosition, this.audio.current.duration))
    this.pendingPosition = 0
  }

  handleVideoMetadata = () => {
    if (!this.video.current) return
    this.props.onStatus({ duration: this.video.current.duration })
    if (this.pendingPosition <= 0) return
    this.video.current.currentTime = Math.min(this.pendingPosition, this.video.current.duration)
    this.pendingPosition = 0
  }

  handleVideoTimeUpdate = () => {
    if (this.video.current) this.props.onStatus({ position: this.video.current.currentTime })
  }

  handleVideoCanPlay = () => {
    this.videoReady = true
    this.updateIsPlaying()
  }

  handleAudioCanPlay = () => {
    this.audioReady = true
    this.updateIsPlaying()
  }

  handleVideoError = () => {
    if (this.usingSourceVideo && this.video.current) {
      const position = this.audio.current?.currentTime || this.video.current.currentTime || 0
      this.usingSourceVideo = false
      this.playRequest++
      this.videoReady = false
      this.video.current.pause()
      this.audio.current?.pause()
      this.pendingPosition = position
      this.video.current.src = `${document.baseURI}api/media/${this.props.mediaId}?type=video${mediaVersion}`
      this.video.current.load()
      return
    }
    const { message, code } = this.video.current.error
    this.props.onError(`${message} (video code ${code})`)
  }

  handleAudioError = () => {
    if (this.usingSourceAudio) {
      this.usingSourceAudio = false
      this.playRequest++
      this.audioReady = false
      this.updateAudioSource(this.audio.current?.currentTime || 0, false)
      return
    }
    const { message, code } = this.audio.current.error
    this.props.onError(`${message} (audio code ${code})`)
  }

  handlePlay = () => this.props.onPlay()

  handleTimeUpdate = () => {
    if (!this.video.current || !this.audio.current) return

    const position = this.audio.current.currentTime
    const drift = this.video.current.currentTime - position
    if (Math.abs(drift) > HARD_SYNC_THRESHOLD) {
      this.video.current.playbackRate = 1
      this.video.current.currentTime = position
    } else if (Math.abs(drift) > SOFT_SYNC_THRESHOLD) {
      // Hard-seeking on every audio timeupdate flushes the video decoder and
      // can cause a permanent stutter loop. Nudge the muted video clock until
      // it catches the audio master instead.
      this.video.current.playbackRate = Math.max(
        1 - MAX_SYNC_RATE_ADJUSTMENT,
        Math.min(1 + MAX_SYNC_RATE_ADJUSTMENT, 1 - drift * 0.1),
      )
    } else if (this.video.current.playbackRate !== 1) {
      this.video.current.playbackRate = 1
    }
    this.props.onStatus({ position })
  }
}

function isPlayInterruption (err: unknown): boolean {
  return err instanceof Error && (
    err.name === 'AbortError'
    || /play\(\) request was interrupted|play request was interrupted/i.test(err.message)
  )
}

export default MP4Player
