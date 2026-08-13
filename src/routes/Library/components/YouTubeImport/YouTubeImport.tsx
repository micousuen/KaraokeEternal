import React, { useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import type { YouTubeSearchResult } from 'shared/types'
import styles from './YouTubeImport.css'

interface YouTubeImportProps {
  onClose: () => void
}

const api = new HttpApi('youtube')
const looksLikeUrl = (value: string) => /^https?:\/\//i.test(value.trim())

const formatDuration = (duration: number | null) => {
  if (duration === null) return 'Duration unavailable'
  const totalSeconds = Math.round(duration)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

const YouTubeImport = ({ onClose }: YouTubeImportProps) => {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<YouTubeSearchResult[]>([])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [isSearching, setSearching] = useState(false)
  const [isSubmitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const download = async (url: string) => {
    setError('')
    setSubmitting(true)
    try {
      await api.post('/', { body: { url } })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = input.trim()
    if (looksLikeUrl(value)) {
      await download(value)
      return
    }

    setError('')
    setSearching(true)
    setResults([])
    setPreviewId(null)

    try {
      const matches = await api.get<YouTubeSearchResult[]>(`/search?q=${encodeURIComponent(value)}`)
      setResults(matches)
      if (!matches.length) setError('No downloadable YouTube videos matched that search.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  const isBusy = isSearching || isSubmitting
  const isUrl = looksLikeUrl(input)

  return (
    <Modal title='Add from YouTube' onClose={onClose} scrollable>
      <form className={styles.form} onSubmit={handleSubmit}>
        <p>Search for a video or paste a public YouTube link. Previewing does not add it to the download queue.</p>
        <input
          type='search'
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder='Song title and artist, or YouTube link'
          required
          autoFocus
          minLength={2}
          maxLength={500}
          disabled={isBusy}
        />

        {error && <div className={styles.error} role='alert'>{error}</div>}

        <div className={styles.buttons}>
          <Button type='submit' variant='primary' disabled={isBusy || input.trim().length < 2}>
            {isSubmitting ? 'Adding…' : isSearching ? 'Searching…' : isUrl ? 'Download' : 'Search'}
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>

        {!!results.length && (
          <ul className={styles.results} aria-label='YouTube search results'>
            {results.map((result) => {
              const isPreviewing = previewId === result.id
              return (
                <li className={styles.result} key={result.id}>
                  <div className={styles.summary}>
                    <img
                      src={result.thumbnailUrl}
                      alt=''
                      loading='lazy'
                      referrerPolicy='no-referrer'
                    />
                    <div className={styles.metadata}>
                      <strong>{result.title}</strong>
                      <span>{[result.channel, formatDuration(result.duration)].filter(Boolean).join(' · ')}</span>
                    </div>
                  </div>
                  <div className={styles.resultButtons}>
                    <Button
                      aria-expanded={isPreviewing}
                      aria-controls={`youtube-preview-${result.id}`}
                      disabled={isSubmitting}
                      onClick={() => setPreviewId(isPreviewing ? null : result.id)}
                    >
                      {isPreviewing ? 'Close preview' : 'Preview'}
                    </Button>
                    <Button variant='primary' disabled={isSubmitting} onClick={() => download(result.url)}>
                      {isSubmitting ? 'Adding…' : 'Download'}
                    </Button>
                  </div>
                  {isPreviewing && (
                    <div className={styles.preview} id={`youtube-preview-${result.id}`}>
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${result.id}?autoplay=1`}
                        title={`Preview ${result.title}`}
                        allow='autoplay; encrypted-media; picture-in-picture; fullscreen'
                        allowFullScreen
                        referrerPolicy='strict-origin-when-cross-origin'
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </form>
    </Modal>
  )
}

export default YouTubeImport
