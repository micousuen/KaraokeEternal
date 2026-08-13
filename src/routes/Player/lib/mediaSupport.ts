import {
  AUDIO_MEDIA_CANDIDATES,
  codecMediaType,
  VIDEO_MEDIA_CANDIDATES,
  type SourceAudioTrack,
  type SourceMediaInfo,
} from 'shared/media'

export type { SourceAudioTrack, SourceMediaInfo } from 'shared/media'

const canPlay = (element: HTMLMediaElement, mimeType: string | null, codec: string | null): boolean =>
  element.canPlayType(codecMediaType(mimeType, codec) || '') !== ''

export const getSupportedMediaTypes = (): { videoTypes: string[], audioTypes: string[] } => {
  const video = document.createElement('video')
  const audio = document.createElement('audio')
  return {
    videoTypes: VIDEO_MEDIA_CANDIDATES.filter(type => video.canPlayType(type) !== ''),
    audioTypes: AUDIO_MEDIA_CANDIDATES.filter(type => audio.canPlayType(type) !== ''),
  }
}

export const supportsSourceVideo = (video: HTMLVideoElement, info: SourceMediaInfo): boolean =>
  canPlay(video, info.videoMimeType, info.videoCodec)

export const supportsSourceAudio = (audio: HTMLAudioElement, track: SourceAudioTrack | null | undefined): boolean =>
  canPlay(audio, track?.mimeType || null, track?.codec || null)
