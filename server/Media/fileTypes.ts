const exported = {
  '.cdg': { mimeType: 'application/octet-stream', scan: false },
  '.m4a': { mimeType: 'audio/mp4', requiresCDG: true },
  '.mkv': { mimeType: 'video/matroska' },
  '.mp3': { mimeType: 'audio/mpeg', requiresCDG: true },
  '.mp4': { mimeType: 'video/mp4' },
  '.zip': { mimeType: 'application/octet-stream' },
}

export default exported
