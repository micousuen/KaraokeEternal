import React from 'react'
import { BROWSER_MEDIA_VERSION } from 'shared/media'
import styles from './MP4Player.css'

const mediaVersion = `&v=${BROWSER_MEDIA_VERSION}`

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

  componentDidMount () {
    this.props.onAudioElement(this.audio.current)
    this.updateSources()
  }

  componentDidUpdate (prevProps: MP4PlayerProps) {
    if (prevProps.mediaKey !== this.props.mediaKey) {
      this.updateSources()
      return
    }

    if (prevProps.audioTrack !== this.props.audioTrack) {
      this.updateAudioSource(this.audio.current?.currentTime || 0)
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
          muted
          preload='auto'
          width={width}
          height={height}
          onError={this.handleVideoError}
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
    this.video.current.src = `${document.baseURI}api/media/${this.props.mediaId}?type=video${mediaVersion}`
    this.video.current.load()
    this.updateAudioSource()

    fetch(`${document.baseURI}api/media/${this.props.mediaId}?type=videoInfo${mediaVersion}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text())
        return response.json()
      })
      .then(({ audioTrackCount }) => this.props.onStatus({ audioTrackCount }))
      .catch(err => this.props.onError(err.message))
  }

  updateAudioSource = (position = 0) => {
    if (!this.audio.current) return

    this.video.current?.pause()
    this.audio.current.pause()
    this.pendingPosition = position
    this.audio.current.src = `${document.baseURI}api/media/${this.props.mediaId}?type=videoAudio&audioTrack=${this.props.audioTrack}${mediaVersion}`
    this.audio.current.load()
  }

  updateIsPlaying = () => {
    if (!this.video.current || !this.audio.current) return

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

  handleVideoError = () => {
    const { message, code } = this.video.current.error
    this.props.onError(`${message} (video code ${code})`)
  }

  handleAudioError = () => {
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
