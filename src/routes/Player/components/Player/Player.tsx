import React from 'react'
import VideoPlayer from './VideoPlayer/VideoPlayer'
import VideoAlphaPlayer from './VideoPlayer/VideoAlphaPlayer'
import { type PlayerState } from '../../modules/player'
import { type PlayerVisualizerState } from '../../modules/playerVisualizer'

const PlayerVisualizer = React.lazy(() => import('./PlayerVisualizer/PlayerVisualizer'))

interface PlayerProps {
  audioTrack: 0 | 1
  isPlaying: boolean
  isVisible: boolean
  isReplayGainEnabled: boolean
  isVideoKeyingEnabled: boolean
  isWebGLSupported: boolean
  mediaId: number
  mediaKey: number
  mediaReplayKey?: number
  mediaSeekKey?: number
  videoAlpha: number
  seekPosition: number
  rgTrackGain?: number
  rgTrackPeak?: number
  visualizer: PlayerVisualizerState
  volume: number
  width: number
  height: number
  // media events
  onEnd(): void
  onError(error: string): void
  onLoad(): void
  onPlay(): void
  onStatus(status: Partial<PlayerState>): void
}

interface State {
  visualizerAudioSourceNode: MediaElementAudioSourceNode | null
}

class Player extends React.Component<PlayerProps> {
  audioCtx: AudioContext | null = null
  audioGainNode: GainNode | null = null
  audioSourceNode: MediaElementAudioSourceNode | null = null
  isFetching = false // internal

  state: State = {
    visualizerAudioSourceNode: null,
  }

  componentDidMount () {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      this.audioGainNode = this.audioCtx.createGain()
    }

    this.updateVolume()
  }

  componentDidUpdate (prevProps: PlayerProps) {
    // may have been suspended by browser if no user interaction yet
    if (this.props.isPlaying && !prevProps.isPlaying) {
      this.audioCtx?.resume()
    }

    // prevent applying next song's RG vals prematurely
    if (this.props.mediaKey !== prevProps.mediaKey) {
      this.isFetching = true
    }

    // don't change volume if we know we're changing songs
    if (!this.isFetching && (prevProps.volume !== this.props.volume
      || prevProps.rgTrackGain !== this.props.rgTrackGain
      || prevProps.rgTrackPeak !== this.props.rgTrackPeak
      || prevProps.isReplayGainEnabled !== this.props.isReplayGainEnabled)) {
      this.updateVolume()
    }
  }

  handleAudioElement = (el: HTMLVideoElement | HTMLAudioElement) => {
    if (!this.audioCtx || (this.audioSourceNode && this.audioSourceNode.mediaElement === el)) {
      return
    }

    this.audioSourceNode = this.audioCtx.createMediaElementSource(el)
    this.audioSourceNode.connect(this.audioGainNode)
    this.audioGainNode.connect(this.audioCtx.destination)

    // hand back copy of original audio source
    const sourceNodeCopy = this.audioSourceNode
    this.setState({ visualizerAudioSourceNode: sourceNodeCopy })
  }

  handlePlay = () => {
    this.isFetching = false
    this.updateVolume()
    this.props.onPlay()
  }

  updateVolume = () => {
    let vol = this.props.volume
    const { isReplayGainEnabled, rgTrackGain, rgTrackPeak } = this.props

    if (isReplayGainEnabled && typeof rgTrackGain === 'number' && typeof rgTrackPeak === 'number') {
      const gainDb = this.props.rgTrackGain
      const peakDb = 20 * Math.log10(this.props.rgTrackPeak) // linear amplitude factor to dB
      const safeGainDb = (gainDb + peakDb >= 0) ? -0.01 - peakDb : gainDb

      vol = vol * Math.pow(10, safeGainDb / 20) // dB to linear amplitude factor
    }

    if (this.audioCtx && this.audioGainNode) {
      this.audioGainNode.gain.setValueAtTime(vol, this.audioCtx.currentTime)
    }
  }

  render () {
    if (!this.props.isVisible || typeof this.props.mediaId !== 'number') return null

    const playerProps = {
      ...this.props,
      onAudioElement: this.handleAudioElement,
      onPlay: this.handlePlay,
    }
    const player = this.props.isVideoKeyingEnabled && !/Web0S|webOS|NetCast/i.test(navigator.userAgent)
      ? <VideoAlphaPlayer {...playerProps} />
      : <VideoPlayer {...playerProps} />

    const isVisualizerActive = this.props.isVideoKeyingEnabled
      && this.props.isWebGLSupported
      && this.props.visualizer.isEnabled
      && this.state.visualizerAudioSourceNode

    return (
      <>
        {player}
        {isVisualizerActive && (
          <PlayerVisualizer
            audioSourceNode={this.state.visualizerAudioSourceNode}
            isPlaying={this.props.isPlaying}
            onError={this.props.onError}
            presetKey={this.props.visualizer.presetKey}
            sensitivity={this.props.visualizer.sensitivity}
            width={this.props.width}
            height={this.props.height}
          />
        )}
      </>
    )
  }
}

export default Player
