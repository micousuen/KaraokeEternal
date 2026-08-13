import React from 'react'
import { updatePlaybackController, VideoPlaybackController, type VideoPlaybackUpdateProps } from './VideoPlaybackController'
import styles from './VideoPlayer.css'

const isWebOs = /Web0S|webOS|NetCast/i.test(navigator.userAgent)

interface VideoPlayerProps extends VideoPlaybackUpdateProps {
  width: number
  height: number
  onAudioElement(audio: HTMLAudioElement): void
  onEnd(): void
}

class VideoPlayer extends React.Component<VideoPlayerProps> {
  video = React.createRef<HTMLVideoElement>()
  audio = React.createRef<HTMLAudioElement>()
  controller: VideoPlaybackController | undefined

  componentDidMount () {
    if (!this.video.current || !this.audio.current) return
    this.controller = new VideoPlaybackController(
      this.video.current,
      this.audio.current,
      () => this.props,
      { combinedPlayback: isWebOs },
    )
    this.props.onAudioElement(isWebOs ? this.video.current as HTMLAudioElement : this.audio.current)
    this.controller.updateSources()
  }

  componentDidUpdate (prevProps: VideoPlayerProps) {
    if (!this.controller) return
    const position = isWebOs ? this.video.current?.currentTime : this.audio.current?.currentTime
    updatePlaybackController(this.controller, prevProps, this.props, position || 0, isWebOs)
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

export default VideoPlayer
