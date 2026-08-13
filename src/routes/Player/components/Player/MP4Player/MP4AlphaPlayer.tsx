import React from 'react'
import GLChroma from 'gl-chromakey'
import { MP4PlaybackController, type MP4PlaybackProps } from './MP4PlaybackController'
import styles from './MP4Player.css'

const BACKDROP_PADDING = 10
const BORDER_RADIUS = parseInt(getComputedStyle(document.body).getPropertyValue('--border-radius'))

interface MP4AlphaPlayerProps extends MP4PlaybackProps {
  mediaKey: number
  mediaReplayKey?: number
  mediaSeekKey?: number
  seekPosition: number
  mp4Alpha: number
  width: number
  height: number
  onAudioElement(audio: HTMLAudioElement): void
  onEnd(): void
}

class MP4AlphaPlayer extends React.Component<MP4AlphaPlayerProps> {
  canvas = React.createRef<HTMLCanvasElement>()
  frameId: number | null = null
  video = document.createElement('video')
  audio = document.createElement('audio')
  chroma: GLChroma
  controller: MP4PlaybackController
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
    this.controller = new MP4PlaybackController(this.video, this.audio, () => this.props, {
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

  componentDidUpdate (prevProps: MP4AlphaPlayerProps) {
    if (prevProps.mediaKey !== this.props.mediaKey) {
      this.controller.updateSources()
      return
    }
    if (prevProps.audioTrack !== this.props.audioTrack) {
      this.controller.updateAudioSource(this.audio.currentTime || 0)
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

    if (!this.props.isPlaying && (
      prevProps.width !== this.props.width
      || prevProps.height !== this.props.height
      || prevProps.mp4Alpha !== this.props.mp4Alpha)
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
    const { mp4Alpha, width, height } = this.props
    const screenAspect = width / height
    const videoAspect = this.state.videoWidth / this.state.videoHeight
    const scale = !isNaN(videoAspect)
      ? (screenAspect > videoAspect ? height / this.state.videoHeight : width / this.state.videoWidth)
      : 0
    const filters = []
    const [x1, y1, x2, y2] = this.state.contentBounds
    const pad = (x2 - x1) && (y2 - y1) ? scale * BACKDROP_PADDING : 0

    if (this.supportsFilters) {
      filters.push(`blur(${30 * mp4Alpha * scale}px)`)
      filters.push(`brightness(${100 - (100 * (mp4Alpha ** 3))}%)`)
      filters.push(`saturate(${100 - (100 * (mp4Alpha ** 3))}%)`)
    }

    return (
      <div className={styles.container}>
        <div
          className={styles.backdrop}
          style={{
            backdropFilter: this.supportsFilters && mp4Alpha !== 1 ? filters.join(' ') : 'none',
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
    const contentBounds = this.chroma.render({ passthrough: this.props.mp4Alpha === 1 }).getContentBounds()
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

export default MP4AlphaPlayer
