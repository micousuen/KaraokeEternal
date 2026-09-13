import React, { useState } from 'react'
import type { YouTubeJob } from 'shared/types'
import Button from 'components/Button/Button'
import HttpApi from 'lib/HttpApi'
import { useAppDispatch } from 'store/hooks'
import { showErrorMessage } from 'store/modules/ui'
import QueueRow from '../QueueRow/QueueRow'
import styles from './YouTubeQueueItem.css'

const api = new HttpApi('youtube')

const YouTubeQueueItem = ({ job }: { job: YouTubeJob }) => {
  const progress = job.progress ?? 0
  const [isRemoving, setRemoving] = useState(false)
  const dispatch = useAppDispatch()

  const remove = async () => {
    if (isRemoving || !confirm(`Remove “${job.title}” from the processing queue?`)) return
    setRemoving(true)
    try {
      await api.delete(`/${encodeURIComponent(job.jobId)}`)
    } catch (error) {
      setRemoving(false)
      dispatch(showErrorMessage(error instanceof Error ? error.message : String(error)))
    }
  }

  return (
    <QueueRow
      className={styles.download}
      style={{ '--download-progress': `${progress}%` } as React.CSSProperties}
      userId={job.userId}
      userDateUpdated={job.userDateUpdated}
    >
      <div className={styles.primary} translate='no'>
        <div className={styles.title}>{job.title}</div>
        <div className={styles.status}>
          {job.message}
          {job.progress !== null && ` (${Math.round(job.progress)}%)`}
        </div>
        <div className={styles.user}>{job.userDisplayName}</div>
      </div>
      <Button
        className={styles.remove}
        icon='DELETE'
        disabled={isRemoving}
        onClick={() => { void remove() }}
        title='Remove from processing queue'
        aria-label={`Remove ${job.title} from processing queue`}
      />
    </QueueRow>
  )
}

export default YouTubeQueueItem
