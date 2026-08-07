import React, { useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import styles from './YouTubeImport.css'

interface YouTubeImportProps {
  onClose: () => void
}

const api = new HttpApi('youtube')

const YouTubeImport = ({ onClose }: YouTubeImportProps) => {
  const [url, setUrl] = useState('')
  const [isSubmitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
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

  return (
    <Modal title='Add from YouTube' onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <p>Paste a public YouTube video link. Private, account-only and live videos are not supported.</p>
        <input
          type='url'
          value={url}
          onChange={event => setUrl(event.target.value)}
          placeholder='https://www.youtube.com/watch?v=...'
          required
          autoFocus
          disabled={isSubmitting}
        />

        {error && <div className={styles.error} role='alert'>{error}</div>}

        <div className={styles.buttons}>
          <Button type='submit' variant='primary' disabled={isSubmitting || !url.trim()}>
            {isSubmitting ? 'Adding…' : 'Download'}
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </form>
    </Modal>
  )
}

export default YouTubeImport
