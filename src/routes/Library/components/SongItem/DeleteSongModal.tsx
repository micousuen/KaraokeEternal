import React, { useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import styles from './RenameSongModal.css'

const api = new HttpApi()

interface DeleteSongModalProps {
  songId: number
  title: string
  artist: string
  onClose(): void
}

const DeleteSongModal = ({ songId, title, artist, onClose }: DeleteSongModalProps) => {
  const [error, setError] = useState('')
  const [isDeleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    setError('')
    try {
      await api.delete(`song/${songId}`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(false)
    }
  }

  return (
    <Modal title='Delete song' onClose={onClose}>
      <div className={styles.form}>
        <p>
          <strong>{artist}</strong>
          {' '}
          -
          {' '}
          <strong>{title}</strong>
          {' '}
          will be permanently deleted from disk, including its script. The song will be
          removed from the library and all room queues. This cannot be undone.
        </p>
        {error && <div className={styles.error} role='alert'>{error}</div>}
        <div className={styles.buttons}>
          <Button variant='danger' disabled={isDeleting} onClick={handleDelete}>
            {isDeleting ? 'Deleting…' : 'Delete permanently'}
          </Button>
          <Button disabled={isDeleting} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}

export default DeleteSongModal
