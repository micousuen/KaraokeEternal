import React from 'react'
import GLChroma from 'gl-chromakey'
import { updatePlaybackController, VideoPlaybackController, type VideoPlaybackUpdateProps } from './VideoPlaybackController'
import styles from './VideoPlayer.css'

const BACKDROP_PADDING = 10
const BORDER_RADIUS = parseInt(getComputedStyle(document.body).getPropertyValue('--border-radius'))

interface VideoAlphaPlayerProps extends VideoPlaybackUpdateProps {
  videoAlpha: number
  width: number
  height: number
  onAudioElement(audio: HTMLAudioElement): void
  onEnd(): void
}

class VideoAlphaPlayer extends React.Component<VideoAlphaPlayerProps> {
  canvas = React.createRef<HTMLCanvasElement>()
  frameId: number | null = null
  video = document.createElement('video')
  audio = document.createElement('audio')
  chroma: GLChroma
  controller: VideoPlaybackController
  supportsFilters = CSS.supports('backdrop-filter', 'blur(10px) brightness(100%) saturate(100%)')
    || CSS.supports('-webkit-backdrop-filter', 'blur(10px) brightness(100%) saturate(100%)')

  state = {
    contentBounds: [0, 0, 0, 0],
    videoWidth: 0,
    videoHeight: 0,
  }

  componentDidMount () {
    this.props.onAudioElement(this.audio)
    this.audio.preload = 'auto'
    this.video.muted = true
    this.video.preload = 'auto'

    if (this.canvas.current) {
      this.chroma = new GLChroma(this.video, this.canvas.current)
      this.chroma.key({ color: 'auto' })
    }
    this.controller = new VideoPlaybackController(this.video, this.audio, () => this.props, {
      onPlaybackStarted: this.startChroma,
      onStopped: this.stopChroma,
    })
    this.audio.oncanplay = this.controller.handleAudioCanPlay
    this.audio.onended = this.handleEnded
    this.audio.onerror = this.controller.handleAudioError
    this.audio.onloadstart = this.props.onLoad
    this.audio.onloadedmetadata = this.controller.handleAudioMetadata
    this.audio.onplay = this.controller.handlePlay
    this.audio.ontimeupdate = this.controller.handleTimeUpdate
    this.video.onerror = this.controller.handleVideoError
    this.video.oncanplay = this.controller.handleVideoCanPlay
    this.video.onloadedmetadata = this.handleLoadedMetadata
    this.controller.updateSources()
  }

  componentDidUpdate (prevProps: VideoAlphaPlayerProps) {
    if (updatePlaybackController(this.controller, prevProps, this.props, this.audio.currentTime || 0)) return

    if (!this.props.isPlaying && (
      prevProps.width !== this.props.width
      || prevProps.height !== this.props.height
      || prevProps.videoAlpha !== this.props.videoAlpha)
    ) this.renderChromaFrame()
  }

  componentWillUnmount () {
    this.audio.ontimeupdate = null
    this.audio.oncanplay = null
    this.video.oncanplay = null
    this.stopChroma()
    this.chroma.unload()
    this.controller.dispose()
  }

  render () {
    const { videoAlpha, width, height } = this.props
    const screenAspect = width / height
    const videoAspect = this.state.videoWidth / this.state.videoHeight
    const scale = !isNaN(videoAspect)
      ? (screenAspect > videoAspect ? height / this.state.videoHeight : width / this.state.videoWidth)
      : 0
    const filters = []
    const [x1, y1, x2, y2] = this.state.contentBounds
    const pad = (x2 - x1) && (y2 - y1) ? scale * BACKDROP_PADDING : 0

    if (this.supportsFilters) {
      filters.push(`blur(${30 * videoAlpha * scale}px)`)
      filters.push(`brightness(${100 - (100 * (videoAlpha ** 3))}%)`)
      filters.push(`saturate(${100 - (100 * (videoAlpha ** 3))}%)`)
    }

    return (
      <div className={styles.container}>
        <div
          className={styles.backdrop}
          style={{
            backdropFilter: this.supportsFilters && videoAlpha !== 1 ? filters.join(' ') : 'none',
            borderRadius: BORDER_RADIUS * scale,
            left: x1 - pad,
            top: y1 - pad,
            width: (x2 - x1) + pad * 2,
            height: (y2 - y1) + pad * 2,
          }}
        />
        <canvas
          className={styles.canvas}
          width={this.state.videoWidth * scale}
          height={this.state.videoHeight * scale}
          ref={this.canvas}
        />
      </div>
    )
  }

  handleLoadedMetadata = () => {
    this.setState({ videoWidth: this.video.videoWidth, videoHeight: this.video.videoHeight })
  }

  handleEnded = () => {
    this.props.onEnd()
    this.stopChroma()
  }

  renderChromaFrame = () => {
    const contentBounds = this.chroma.render({ passthrough: this.props.videoAlpha === 1 }).getContentBounds()
    if (!contentBounds.every((value, index) => value === this.state.contentBounds[index])) {
      this.setState({ contentBounds })
    }
  }

  startChroma = () => {
    this.stopChroma()
    this.frameId = requestAnimationFrame(this.startChroma)
    this.renderChromaFrame()
  }

  stopChroma = () => {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.frameId = null
  }
}

export default VideoAlphaPlayer
