import React, { useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import styles from './RenameSongModal.css'

const api = new HttpApi()

interface AiRenameSongModalProps {
  songId: number
  onClose(): void
}

const AiRenameSongModal = ({ songId, onClose }: AiRenameSongModalProps) => {
  const [error, setError] = useState('')
  const [isRenaming, setRenaming] = useState(false)

  const handleRename = async () => {
    setRenaming(true)
    setError('')
    try {
      await api.post(`song/${songId}/ai-rename`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRenaming(false)
    }
  }

  return (
    <Modal title='Rename with AI' onClose={onClose}>
      <div className={styles.form}>
        <p>
          The artist and song title will be extracted from the original YouTube video title with
          DeepSeek, and the media file will be renamed to the Artist-Title format used across the
          library.
        </p>
        {error && <div className={styles.error} role='alert'>{error}</div>}
        <div className={styles.buttons}>
          <Button variant='primary' disabled={isRenaming} onClick={handleRename}>
            {isRenaming ? 'Renaming…' : 'Rename with AI'}
          </Button>
          <Button disabled={isRenaming} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}

export default AiRenameSongModal
