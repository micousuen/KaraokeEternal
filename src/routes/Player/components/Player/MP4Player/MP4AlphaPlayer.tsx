import React from 'react'
import GLChroma from 'gl-chromakey'
import styles from './MP4Player.css'

const BACKDROP_PADDING = 10 // px at 1:1 scale
const BORDER_RADIUS = parseInt(getComputedStyle(document.body).getPropertyValue('--border-radius'))

interface MP4AlphaPlayerProps {
  audioTrack: 0 | 1
  isPlaying: boolean
  mediaId: number
  mediaKey: number
  mediaReplayKey?: number
  mediaSeekKey?: number
  seekPosition: number
  mp4Alpha: number
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

class MP4AlphaPlayer extends React.Component<MP4AlphaPlayerProps> {
  canvas = React.createRef<HTMLCanvasElement>()
  frameId: number | null = null
  video = document.createElement('video')
  audio = document.createElement('audio')
  pendingPosition = 0
  chroma: GLChroma
  supportsFilters = CSS.supports('backdrop-filter', 'blur(10px) brightness(100%) saturate(100%)') || CSS.supports('-webkit-backdrop-filter', 'blur(10px) brightness(100%) saturate(100%)')
  state = {
    contentBounds: [0, 0, 0, 0], // x1, y1, x2, y2
    videoWidth: 0,
    videoHeight: 0,
  }

  componentDidMount () {
    this.props.onAudioElement(this.audio)
    this.audio.oncanplaythrough = this.updateIsPlaying
    this.audio.onended = this.handleEnded
    this.audio.onerror = this.handleAudioError
    this.audio.onloadstart = this.props.onLoad
    this.audio.onloadedmetadata = this.handleAudioMetadata
    this.audio.onplay = this.handlePlay
    this.audio.ontimeupdate = this.handleTimeUpdate
    this.audio.preload = 'auto'

    this.video.onerror = this.handleVideoError
    this.video.onloadedmetadata = this.handleLoadedMetadata
    this.video.muted = true
    this.video.preload = 'auto'

    if (this.canvas.current) {
      this.chroma = new GLChroma(this.video, this.canvas.current)
      this.chroma.key({ color: 'auto' })
    }

    this.updateSources()
  }

  componentDidUpdate (prevProps: MP4AlphaPlayerProps) {
    if (prevProps.mediaKey !== this.props.mediaKey) {
      this.updateSources()
      return
    }

    if (prevProps.audioTrack !== this.props.audioTrack) {
      this.updateAudioSource(this.audio.currentTime || 0)
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

    if (!this.props.isPlaying && (
      prevProps.width !== this.props.width
      || prevProps.height !== this.props.height
      || prevProps.mp4Alpha !== this.props.mp4Alpha)
    ) {
      const contentBounds = this.chroma.render({ passthrough: this.props.mp4Alpha === 1 }).getContentBounds()

      if (!contentBounds.every((val, i) => val === this.state.contentBounds[i])) {
        this.setState({ contentBounds })
      }
    }
  }

  componentWillUnmount () {
    this.audio.ontimeupdate = null
    this.audio.pause()
    this.video.pause()
    this.stopChroma()

    this.chroma.unload()
    this.video.removeAttribute('src')
    this.video.load() // reset to ensure playback stops
    this.audio.removeAttribute('src')
    this.audio.load()
  }

  render () {
    const { mp4Alpha, width, height } = this.props
    const screenAspect = width / height
    const videoAspect = this.state.videoWidth / this.state.videoHeight
    const scale = !isNaN(videoAspect)
      ? (screenAspect > videoAspect
          ? height / this.state.videoHeight
          : width / this.state.videoWidth)
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
        >
        </div>
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
    this.setState({
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
    })
  }

  updateSources = () => {
    this.stopChroma()
    this.video.src = `${document.baseURI}api/media/${this.props.mediaId}?type=video`
    this.video.load()
    this.updateAudioSource()

    fetch(`${document.baseURI}api/media/${this.props.mediaId}?type=videoInfo`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text())
        return response.json()
      })
      .then(({ audioTrackCount }) => this.props.onStatus({ audioTrackCount }))
      .catch(err => this.props.onError(err.message))
  }

  updateAudioSource = (position = 0) => {
    this.video.pause()
    this.audio.pause()
    this.pendingPosition = position
    this.audio.src = `${document.baseURI}api/media/${this.props.mediaId}?type=videoAudio&audioTrack=${this.props.audioTrack}`
    this.audio.load()
  }

  updateIsPlaying = () => {
    if (this.props.isPlaying) {
      this.video.currentTime = this.audio.currentTime
      Promise.all([this.video.play(), this.audio.play()])
        .catch(err => this.props.onError(err.message))
    } else {
      this.audio.pause()
      this.video.pause()
      this.stopChroma()
    }
  }

  startChroma = () => {
    this.frameId = requestAnimationFrame(this.startChroma)
    const contentBounds = this.chroma.render({ passthrough: this.props.mp4Alpha === 1 }).getContentBounds()

    // content bounds changed?
    if (!contentBounds.every((val, i) => val === this.state.contentBounds[i])) {
      this.setState({ contentBounds })
    }
  }

  stopChroma = () => cancelAnimationFrame(this.frameId)

  /*
  * <video> event handlers
  */
  handleEnded = () => {
    this.props.onEnd()
    this.stopChroma()
  }

  handleVideoError = () => {
    const { message, code } = this.video.error
    this.props.onError(`${message} (video code ${code})`)
  }

  handleAudioError = () => {
    const { message, code } = this.audio.error
    this.props.onError(`${message} (audio code ${code})`)
  }

  handleAudioMetadata = () => {
    this.props.onStatus({ duration: this.audio.duration })
    if (this.pendingPosition <= 0) return
    this.setCurrentTime(Math.min(this.pendingPosition, this.audio.duration))
    this.pendingPosition = 0
  }

  handlePlay = () => {
    this.props.onPlay()
    this.startChroma()
  }

  handleTimeUpdate = () => {
    const position = this.audio.currentTime
    if (Math.abs(this.video.currentTime - position) > 0.2) {
      this.video.currentTime = position
    }
    this.props.onStatus({ position })
  }

  setCurrentTime = (position: number) => {
    this.video.currentTime = position
    this.audio.currentTime = position
  }
}

export default MP4AlphaPlayer
