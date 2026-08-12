export interface FilenameFields {
  artist: string
  title: string
  language: string
}

export default function parseFilename (name: string, format: string): FilenameFields | undefined {
  if (format !== 'artist-title-language') return

  const parts = name.split('-').map(part => part.trim())
  if (parts.length < 3) throw new Error('expected filename format: singer-song-language')

  const artist = parts.shift()
  const language = parts.pop()
  const title = parts.join(' - ')

  if (!artist || !title || !language) throw new Error('singer, song, and language must not be empty')
  return { artist, title, language }
}
