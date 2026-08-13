import React, { useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import styles from './RenameSongModal.css'

const api = new HttpApi()

export type RegenerateOutput = 'instrumental' | 'script'

interface RegenerateSongModalProps {
  songId: number
  output: RegenerateOutput
  onClose(): void
}

const RegenerateSongModal = ({ songId, output, onClose }: RegenerateSongModalProps) => {
  const [error, setError] = useState('')
  const [isStarting, setStarting] = useState(false)
  const label = output === 'instrumental' ? 'instrumental track' : 'script'

  const handleRegenerate = async () => {
    setStarting(true)
    setError('')
    try {
      await api.post(`song/${songId}/regenerate`, { body: { output } })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStarting(false)
    }
  }

  return (
    <Modal title={`Regenerate ${label}`} onClose={onClose}>
      <div className={styles.form}>
        <p>
          The vocal track will be separated again. The existing
          {' '}
          {label}
          {' '}
          will only be replaced after processing succeeds.
        </p>
        {error && <div className={styles.error} role='alert'>{error}</div>}
        <div className={styles.buttons}>
          <Button variant='primary' disabled={isStarting} onClick={handleRegenerate}>
            {isStarting ? 'Queuing…' : 'Regenerate'}
          </Button>
          <Button disabled={isStarting} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}

export default RegenerateSongModal
