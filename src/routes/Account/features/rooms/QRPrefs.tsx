import React, { useCallback } from 'react'
import clsx from 'clsx'
import Accordion from 'components/Accordion/Accordion'
import Icon from 'components/Icon/Icon'
import Slider from 'components/Slider/Slider'
import type { IRoomPrefs } from 'shared/types'
import styles from './QRPrefs.css'

interface QRPrefsProps {
  prefs: Partial<IRoomPrefs>
  onChange: (prefs: Partial<IRoomPrefs>) => void
}

const QRPrefs = ({ onChange, prefs = {} }: QRPrefsProps) => {
  const handleSetPref = useCallback((update: Partial<IRoomPrefs>) => {
    onChange({ ...prefs, ...update })
  }, [onChange, prefs])

  return (
    <Accordion
      headingComponent={(
        <div className={styles.heading}>
          <Icon icon='QR_CODE' />
          <div className={styles.title}>QR Code</div>
        </div>
      )}
    >
      <div className={styles.content}>
        <p>QR access is always enabled and protected by a server-generated room secret.</p>
        <div className={clsx(styles.field)}>
          <label id='label-qr-size'>Size</label>
          <Slider
            className={styles.slider}
            min={0}
            max={1}
            step={0.05}
            value={prefs?.qr?.size ?? 0.5}
            onChange={(val: number) => handleSetPref({ qr: { ...prefs.qr, size: val } })}
            aria-labelledby='label-qr-size'
          />
        </div>
        <div className={clsx(styles.field)}>
          <label id='label-qr-opacity'>Opacity</label>
          <Slider
            className={styles.slider}
            min={0.25}
            max={1}
            step={0.075}
            value={prefs?.qr?.opacity ?? 0.625}
            onChange={(val: number) => handleSetPref({ qr: { ...prefs.qr, opacity: val } })}
            aria-labelledby='label-qr-opacity'
          />
        </div>
      </div>
    </Accordion>
  )
}

export default QRPrefs
