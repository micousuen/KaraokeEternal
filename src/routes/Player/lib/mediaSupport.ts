export interface SourceAudioTrack {
  codec: string | null
  extension: string | null
  mimeType: string | null
}

export interface SourceMediaInfo {
  audioTrackCount: number
  videoMimeType: string | null
  videoCodec: string | null
  audioTracks: Array<SourceAudioTrack | null>
}

const videoCandidates = [
  'video/mp4; codecs="avc1"',
  'video/mp4; codecs="hvc1"',
  'video/mp4; codecs="hev1"',
  'video/mp4; codecs="vp09"',
  'video/mp4; codecs="av01"',
  'video/mp4; codecs="mp4v"',
]

const audioCandidates = [
  'audio/mp4; codecs="mp4a"',
  'audio/mp4; codecs="alac"',
  'audio/mpeg; codecs="mp3"',
  'audio/ogg; codecs="opus"',
  'audio/ogg; codecs="vorbis"',
  'audio/flac; codecs="flac"',
]

const canPlay = (element: HTMLMediaElement, mimeType: string | null, codec: string | null): boolean =>
  !!mimeType && !!codec && element.canPlayType(`${mimeType}; codecs="${codec}"`) !== ''

export const getSupportedMediaTypes = (): { videoTypes: string[], audioTypes: string[] } => {
  const video = document.createElement('video')
  const audio = document.createElement('audio')
  return {
    videoTypes: videoCandidates.filter(type => video.canPlayType(type) !== ''),
    audioTypes: audioCandidates.filter(type => audio.canPlayType(type) !== ''),
  }
}

export const supportsSourceVideo = (video: HTMLVideoElement, info: SourceMediaInfo): boolean =>
  canPlay(video, info.videoMimeType, info.videoCodec)

export const supportsSourceAudio = (audio: HTMLAudioElement, track: SourceAudioTrack | null | undefined): boolean =>
  canPlay(audio, track?.mimeType || null, track?.codec || null)
