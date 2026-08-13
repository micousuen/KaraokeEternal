import React from 'react'
import type { YouTubeJob } from 'shared/types'
import QueueRow from '../QueueRow/QueueRow'
import styles from './YouTubeQueueItem.css'

const YouTubeQueueItem = ({ job }: { job: YouTubeJob }) => {
  const progress = job.progress ?? 0

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
    </QueueRow>
  )
}

export default YouTubeQueueItem
