import React from 'react'
import Slider from 'components/Slider/Slider'
import { formatDuration } from 'lib/dateTime'
import styles from './PlaybackProgress.css'

interface PlaybackProgressProps {
  duration: number
  position: number
  onSeek: (position: number) => void
}

const PlaybackProgress = ({ duration, position, onSeek }: PlaybackProgressProps) => {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const safePosition = Math.min(Math.max(position, 0), safeDuration)

  return (
    <div className={styles.container}>
      <span className={styles.time}>{formatDuration(Math.floor(safePosition))}</span>
      <Slider
        aria-label='Playback position'
        className={styles.slider}
        disabled={!safeDuration}
        min={0}
        max={safeDuration || 1}
        onChange={onSeek}
        step={0.1}
        value={safePosition}
      />
      <span className={styles.time}>{formatDuration(Math.floor(safeDuration))}</span>
    </div>
  )
}

export default PlaybackProgress
