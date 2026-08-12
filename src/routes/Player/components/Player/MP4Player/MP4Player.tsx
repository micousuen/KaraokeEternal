import React from 'react'
import { BROWSER_MEDIA_VERSION } from 'shared/media'
import { type SourceMediaInfo, supportsSourceAudio, supportsSourceVideo } from '../../../lib/mediaSupport'
import styles from './MP4Player.css'

const mediaVersion = `&v=${BROWSER_MEDIA_VERSION}`
const audioFormat = /Web0S|webOS|NetCast/i.test(navigator.userAgent) ? '&audioFormat=aac' : ''
const isWebOs = /Web0S|webOS|NetCast/i.test(navigator.userAgent)

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
          onCanPlayThrough={isWebOs ? this.updateIsPlaying : undefined}
          onEnded={isWebOs ? this.props.onEnd : undefined}
          onLoadStart={isWebOs ? this.props.onLoad : undefined}
          onLoadedMetadata={isWebOs ? this.handleVideoMetadata : undefined}
          onPlay={isWebOs ? this.handlePlay : undefined}
          onTimeUpdate={isWebOs ? this.handleVideoTimeUpdate : undefined}
          ref={this.video}
        />
        <audio
          preload='auto'
          onCanPlayThrough={this.updateIsPlaying}
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
        this.video.current.src = `${document.baseURI}api/media/${this.props.mediaId}?type=${this.usingSourceVideo ? 'sourceVideo' : 'video'}${mediaVersion}`
        this.video.current.load()
        this.updateAudioSource()
        return undefined
      })
      .catch((err): undefined => {
        if (request !== this.sourceRequest || !this.video.current) return undefined
        this.usingSourceVideo = false
        this.usingSourceAudio = false
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
    this.pendingPosition = position
    this.video.current.src = `${document.baseURI}api/media/${this.props.mediaId}?type=videoCombined&audioTrack=${this.props.audioTrack}${mediaVersion}`
    this.video.current.load()
  }

  updateAudioSource = (position = 0, preferSource = true) => {
    if (!this.audio.current) return

    this.video.current?.pause()
    this.audio.current.pause()
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
        this.video.current.play().catch(err => this.props.onError(err.message))
      } else {
        this.video.current.pause()
      }
      return
    }

    if (this.props.isPlaying) {
      this.video.current.currentTime = this.audio.current.currentTime
      Promise.all([this.video.current.play(), this.audio.current.play()])
        .catch(err => this.props.onError(err.message))
    } else {
      this.video.current.pause()
      this.audio.current.pause()
    }
  }

  setCurrentTime = (position: number) => {
    if (this.video.current) this.video.current.currentTime = position
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

  handleVideoError = () => {
    if (this.usingSourceVideo && this.video.current) {
      this.usingSourceVideo = false
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
    if (Math.abs(this.video.current.currentTime - position) > 0.2) {
      this.video.current.currentTime = position
    }
    this.props.onStatus({ position })
  }
}

export default MP4Player
