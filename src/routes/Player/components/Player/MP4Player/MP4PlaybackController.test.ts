import { afterEach, describe, expect, it, vi } from 'vitest'
import { MP4PlaybackController, type MP4PlaybackProps } from './MP4PlaybackController'

afterEach(() => vi.unstubAllGlobals())

describe('MP4PlaybackController', () => {
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
    const props: MP4PlaybackProps = {
      audioTrack: 1,
      isPlaying: false,
      mediaId: 42,
      onError: vi.fn(),
      onLoad: vi.fn(),
      onPlay: vi.fn(),
      onStatus: vi.fn(),
    }
    const controller = new MP4PlaybackController(video, audio, () => props)

    controller.updateSources()

    await vi.waitFor(() => expect(video.load).toHaveBeenCalled())
    expect(video.src).toContain('type=sourceVideo')
    expect(audio.src).toContain('type=sourceAudio&audioTrack=1')
    expect(props.onStatus).toHaveBeenCalledWith({ audioTrackCount: 2 })
  })
})

function mediaElement (kind: string): HTMLMediaElement {
  return {
    canPlayType: vi.fn(() => 'probably'),
    currentTime: 0,
    duration: 100,
    error: null,
    load: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(async () => undefined),
    removeAttribute: vi.fn(),
    src: '',
    tagName: kind,
  } as unknown as HTMLMediaElement
}
