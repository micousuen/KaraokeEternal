import React, { useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import styles from './RenameSongModal.css'

const api = new HttpApi()

interface RenameSongModalProps {
  songId: number
  title: string
  artist: string
  onClose(): void
}

const RenameSongModal = ({ songId, title, artist: initialArtist, onClose }: RenameSongModalProps) => {
  const [name, setName] = useState(title)
  const [artist, setArtist] = useState(initialArtist)
  const [error, setError] = useState('')
  const [isSaving, setSaving] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.put(`song/${songId}/name`, { body: { name, artist } })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <Modal title='Edit song' onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label>
          Song name
          <input
            autoFocus
            disabled={isSaving}
            maxLength={150}
            onChange={event => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label>
          Author
          <input
            disabled={isSaving}
            maxLength={150}
            onChange={event => setArtist(event.target.value)}
            required
            value={artist}
          />
        </label>
        <p>The associated media file will be renamed too. Its file extension will be preserved.</p>
        {error && <div className={styles.error} role='alert'>{error}</div>}
        <div className={styles.buttons}>
          <Button type='submit' variant='primary' disabled={isSaving || !name.trim() || !artist.trim()}>
            {isSaving ? 'Saving…' : 'Rename'}
          </Button>
          <Button onClick={onClose} disabled={isSaving}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}

export default RenameSongModal
