import React from 'react'
import { Link } from 'react-router'
import styles from './NoPlayer.css'

const NoPlayer = ({ canLaunchPlayer }: { canLaunchPlayer: boolean }) => (
  <div className={styles.container}>
    <p className={styles.msg}>
      No player is connected to this room
      {canLaunchPlayer && (
        <>
          {' ('}
          <Link to='/player' target='_blank' replace>Launch Player</Link>
          )
        </>
      )}
    </p>
  </div>
)

export default NoPlayer
