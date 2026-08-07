export interface FilenameFields {
  artist: string
  title: string
}

export default function parseFilename (name: string, format: string): FilenameFields | undefined {
  if (format !== 'artist-title-language') return

  const parts = name.split('-').map(part => part.trim())
  if (parts.length < 3) throw new Error('expected filename format: singer-song-language')

  const artist = parts.shift()
  parts.pop() // language is not represented in the current database schema
  const title = parts.join(' - ')

  if (!artist || !title) throw new Error('singer and song must not be empty')
  return { artist, title }
}
