const exported = {
  // Transcoded audio responses use these MIME types, but audio-only files are
  // no longer library media.
  '.m4a': { mimeType: 'audio/mp4', scan: false },
  '.mkv': { mimeType: 'video/matroska' },
  '.mp3': { mimeType: 'audio/mpeg', scan: false },
  '.mp4': { mimeType: 'video/mp4' },
}

export default exported
