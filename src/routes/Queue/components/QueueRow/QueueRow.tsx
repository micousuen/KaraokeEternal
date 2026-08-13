import React from 'react'
import clsx from 'clsx'
import UserImage from 'components/UserImage/UserImage'
import styles from './QueueRow.css'

interface QueueRowProps extends React.HTMLAttributes<HTMLDivElement> {
  imageClassName?: string
  leading?: React.ReactNode
  userDateUpdated: number
  userId: number
}

const QueueRow = ({ children, className, imageClassName, leading, userDateUpdated, userId, ...props }: QueueRowProps) => (
  <div {...props} className={clsx(styles.container, className)}>
    <div className={styles.content}>
      {leading}
      <div className={clsx(styles.imageContainer, imageClassName)}>
        <UserImage userId={userId} dateUpdated={userDateUpdated} />
      </div>
      {children}
    </div>
  </div>
)

export default QueueRow
