import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoPlaybackController, type VideoPlaybackProps } from './VideoPlaybackController'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('VideoPlaybackController', () => {
  it('selects directly supported source video and audio', async () => {
    vi.stubGlobal('document', { baseURI: '/karaoke/' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        audioTrackCount: 2,
        videoMimeType: 'video/mp4',
        videoCodec: 'avc1',
        audioTracks: [
          { codec: 'mp4a', extension: 'm4a', mimeType: 'audio/mp4' },
          { codec: 'mp4a', extension: 'm4a', mimeType: 'audio/mp4' },
        ],
      }),
    })))
    const video = mediaElement('video') as HTMLVideoElement
    const audio = mediaElement('audio') as HTMLAudioElement
    const props: VideoPlaybackProps = {
      audioTrack: 1,
      isPlaying: false,
      mediaId: 42,
      onError: vi.fn(),
      onLoad: vi.fn(),
      onPlay: vi.fn(),
      onStatus: vi.fn(),
    }
    const controller = new VideoPlaybackController(video, audio, () => props)

    controller.updateSources()

    await vi.waitFor(() => expect(video.load).toHaveBeenCalled())
    expect(video.src).toContain('type=sourceVideo')
    expect(audio.src).toContain('type=sourceAudio&audioTrack=1')
    expect(props.onStatus).toHaveBeenCalledWith({ audioTrackCount: 2 })
  })
})

describe('audio/video drift synchronization', () => {
  it('nudges the playback rate instead of seeking for small drift', () => {
    const { controller, video, audio } = dualController()
    audio.currentTime = 10.24
    video.currentTime = 10

    controller.handleTimeUpdate()

    expect(video.currentTime).toBe(10)
    expect(video.playbackRate).toBe(1.05)
  })

  it('nudges strongly for medium drift and in reverse when video is ahead', () => {
    const { controller, video, audio } = dualController()
    audio.currentTime = 10.3
    video.currentTime = 10
    controller.handleTimeUpdate()
    expect(video.playbackRate).toBe(1.1)

    audio.currentTime = 10
    video.currentTime = 10.3
    video.playbackRate = 1
    controller.handleTimeUpdate()
    expect(video.playbackRate).toBe(0.9)
  })

  it('hard-seeks when drift exceeds the threshold and reports the position', () => {
    const { controller, video, audio, props } = dualController()
    audio.currentTime = 10.6
    video.currentTime = 10

    controller.handleTimeUpdate()

    expect(video.currentTime).toBe(10.6)
    expect(video.playbackRate).toBe(1)
    expect(props.onStatus).toHaveBeenCalledWith({ position: 10.6 })
  })

  it('lets a hard seek settle before seeking again', () => {
    const { controller, video, audio } = dualController()
    audio.currentTime = 10.6
    video.currentTime = 10
    controller.handleTimeUpdate()
    expect(video.currentTime).toBe(10.6)

    audio.currentTime = 11.2
    controller.handleTimeUpdate()
    expect(video.currentTime).toBe(10.6)
    expect(video.playbackRate).toBe(1.1)
  })

  it('returns the playback rate to normal once synchronized', () => {
    const { controller, video, audio } = dualController()
    audio.currentTime = 10.24
    video.currentTime = 10
    controller.handleTimeUpdate()
    expect(video.playbackRate).toBe(1.05)

    audio.currentTime = 10.25
    video.currentTime = 10.25
    controller.handleTimeUpdate()
    expect(video.playbackRate).toBe(1)
  })
})

describe('interrupted playback', () => {
  it('retries playback after an interrupted play request instead of going silent', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { baseURI: '/karaoke/' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async (): Promise<object> => ({ audioTrackCount: 1, videoMimeType: null, videoCodec: null, audioTracks: [null] }),
    })))

    let attempts = 0
    const video = mediaElement('video', () => {
      attempts++
      return attempts === 1
        ? Promise.reject(Object.assign(new Error('The play() request was interrupted'), { name: 'AbortError' }))
        : Promise.resolve()
    }) as HTMLVideoElement
    const audio = mediaElement('audio') as HTMLAudioElement
    const props: VideoPlaybackProps = {
      audioTrack: 0,
      isPlaying: false,
      mediaId: 42,
      onError: vi.fn(),
      onLoad: vi.fn(),
      onPlay: vi.fn(),
      onStatus: vi.fn(),
    }
    const controller = new VideoPlaybackController(video, audio, () => props)

    controller.handleVideoCanPlay()
    controller.handleAudioCanPlay()
    expect(video.play).not.toHaveBeenCalled()

    props.isPlaying = true
    controller.updateIsPlaying()
    expect(video.play).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(300)
    expect(video.play).toHaveBeenCalledTimes(2)
    expect(props.onError).not.toHaveBeenCalled()
  })
})

function dualController () {
  vi.stubGlobal('document', { baseURI: '/karaoke/' })
  const video = mediaElement('video') as HTMLVideoElement
  const audio = mediaElement('audio') as HTMLAudioElement
  const props: VideoPlaybackProps = {
    audioTrack: 0,
    isPlaying: false,
    mediaId: 42,
    onError: vi.fn(),
    onLoad: vi.fn(),
    onPlay: vi.fn(),
    onStatus: vi.fn(),
  }
  return { controller: new VideoPlaybackController(video, audio, () => props), props, video, audio }
}

function mediaElement (kind: string, playImpl: () => Promise<void> = () => Promise.resolve()): HTMLMediaElement {
  return {
    canPlayType: vi.fn(() => 'probably'),
    currentTime: 0,
    duration: 100,
    error: null,
    load: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(playImpl),
    playbackRate: 1,
    removeAttribute: vi.fn(),
    src: '',
    tagName: kind,
  } as unknown as HTMLMediaElement
}
