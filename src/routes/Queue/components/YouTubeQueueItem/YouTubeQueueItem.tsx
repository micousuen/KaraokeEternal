import React from 'react'
import UserImage from 'components/UserImage/UserImage'
import type { YouTubeJob } from 'shared/types'
import styles from './YouTubeQueueItem.css'

const YouTubeQueueItem = ({ job }: { job: YouTubeJob }) => {
  const progress = job.progress ?? 0

  return (
    <div
      className={styles.container}
      style={{ '--download-progress': `${progress}%` } as React.CSSProperties}
    >
      <div className={styles.content}>
        <div className={styles.imageContainer}>
          <UserImage userId={job.userId} dateUpdated={job.userDateUpdated} />
        </div>
        <div className={styles.primary} translate='no'>
          <div className={styles.title}>{job.title}</div>
          <div className={styles.status}>
            {job.message}
            {job.progress !== null && ` (${Math.round(job.progress)}%)`}
          </div>
          <div className={styles.user}>{job.userDisplayName}</div>
        </div>
      </div>
    </div>
  )
}

export default YouTubeQueueItem
