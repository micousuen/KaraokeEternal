import React, { useEffect, useRef, useState } from 'react'
import Slider from 'components/Slider/Slider'
import Button from 'components/Button/Button'
import styles from './VolumeSlider.css'

interface VolumeSliderProps {
  volume: number
  onVolumeChange: (value: number) => void
}

const VolumeSlider = ({ volume, onVolumeChange }: VolumeSliderProps) => {
  const [isOpen, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const icon = volume === 0
    ? 'VOLUME_OFF'
    : volume < 0.4
      ? 'VOLUME_MUTE'
      : volume < 0.7
        ? 'VOLUME_DOWN'
        : 'VOLUME_UP'

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className={styles.container} ref={container}>
      <Button
        aria-expanded={isOpen}
        aria-haspopup='true'
        aria-label='Volume'
        className={styles.button}
        icon={icon}
        onClick={() => setOpen(!isOpen)}
      />
      {isOpen && (
        <div className={styles.popover}>
          <Slider
            aria-label='Volume level'
            className={styles.slider}
            min={0}
            max={1}
            onChange={onVolumeChange}
            step={0.01}
            value={volume}
          />
        </div>
      )}
    </div>
  )
}

export default VolumeSlider
