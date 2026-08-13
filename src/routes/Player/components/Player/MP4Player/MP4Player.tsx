import React from 'react'
import { MP4PlaybackController, type MP4PlaybackProps } from './MP4PlaybackController'
import styles from './MP4Player.css'

const isWebOs = /Web0S|webOS|NetCast/i.test(navigator.userAgent)

interface MP4PlayerProps extends MP4PlaybackProps {
  mediaKey: number
  mediaReplayKey?: number
  mediaSeekKey?: number
  seekPosition: number
  width: number
  height: number
  onAudioElement(audio: HTMLAudioElement): void
  onEnd(): void
}

class MP4Player extends React.Component<MP4PlayerProps> {
  video = React.createRef<HTMLVideoElement>()
  audio = React.createRef<HTMLAudioElement>()
  controller: MP4PlaybackController | undefined

  componentDidMount () {
    if (!this.video.current || !this.audio.current) return
    this.controller = new MP4PlaybackController(
      this.video.current,
      this.audio.current,
      () => this.props,
      { combinedPlayback: isWebOs },
    )
    this.props.onAudioElement(isWebOs ? this.video.current as HTMLAudioElement : this.audio.current)
    this.controller.updateSources()
  }

  componentDidUpdate (prevProps: MP4PlayerProps) {
    if (!this.controller) return
    if (prevProps.mediaKey !== this.props.mediaKey) {
      this.controller.updateSources()
      return
    }
    if (prevProps.audioTrack !== this.props.audioTrack) {
      if (isWebOs) this.controller.updateCombinedSource(this.video.current?.currentTime || 0)
      else this.controller.updateAudioSource(this.audio.current?.currentTime || 0)
      return
    }
    if (prevProps.mediaReplayKey !== this.props.mediaReplayKey) {
      this.controller.setCurrentTime(0)
      return
    }
    if (prevProps.mediaSeekKey !== this.props.mediaSeekKey) {
      this.controller.setCurrentTime(this.props.seekPosition)
      return
    }
    if (prevProps.isPlaying !== this.props.isPlaying) this.controller.updateIsPlaying()
  }

  componentWillUnmount () {
    this.controller?.dispose()
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
          onError={() => this.controller?.handleVideoError()}
          onCanPlay={() => this.controller?.handleVideoCanPlay()}
          onEnded={isWebOs ? this.props.onEnd : undefined}
          onLoadStart={isWebOs ? this.props.onLoad : undefined}
          onLoadedMetadata={isWebOs ? () => this.controller?.handleVideoMetadata() : undefined}
          onPlay={isWebOs ? () => this.controller?.handlePlay() : undefined}
          onTimeUpdate={isWebOs ? () => this.controller?.handleVideoTimeUpdate() : undefined}
          ref={this.video}
        />
        <audio
          preload='auto'
          onCanPlay={() => this.controller?.handleAudioCanPlay()}
          onEnded={this.props.onEnd}
          onError={() => this.controller?.handleAudioError()}
          onLoadStart={this.props.onLoad}
          onLoadedMetadata={() => this.controller?.handleAudioMetadata()}
          onPlay={() => this.controller?.handlePlay()}
          onTimeUpdate={() => this.controller?.handleTimeUpdate()}
          ref={this.audio}
        />
      </>
    )
  }
}

export default MP4Player
