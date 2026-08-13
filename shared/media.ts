// Increment whenever the browser-facing transcode format changes. This also
// versions media URLs so browsers cannot reuse bytes from an older container.
export const BROWSER_MEDIA_VERSION = 6

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

export const VIDEO_MEDIA_CANDIDATES = [
  'video/mp4; codecs="avc1"',
  'video/mp4; codecs="hvc1"',
  'video/mp4; codecs="hev1"',
  'video/mp4; codecs="vp09"',
  'video/mp4; codecs="av01"',
  'video/mp4; codecs="mp4v"',
]

export const AUDIO_MEDIA_CANDIDATES = [
  'audio/mp4; codecs="mp4a"',
  'audio/mp4; codecs="alac"',
  'audio/mpeg; codecs="mp3"',
  'audio/ogg; codecs="opus"',
  'audio/ogg; codecs="vorbis"',
  'audio/flac; codecs="flac"',
]

export function codecMediaType (mimeType: string | null | undefined, codec: string | null): string | null {
  return mimeType && codec ? `${mimeType}; codecs="${codec}"` : null
}
