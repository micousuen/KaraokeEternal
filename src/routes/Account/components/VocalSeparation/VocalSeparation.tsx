import React, { useEffect, useState } from 'react'
import Button from 'components/Button/Button'
import Panel from 'components/Panel/Panel'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { requestScanAll } from 'store/modules/prefs'
import styles from './VocalSeparation.css'

const formatSpeed = (speed: number | null) => speed === null ? 'Waiting for first result' : `${speed.toFixed(2)}× realtime`

const VocalSeparation = () => {
  const status = useAppSelector(state => state.vocalSeparation)
  const isScanning = useAppSelector(state => state.prefs.isScanning)
  const dispatch = useAppDispatch()
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (status.currentStartedAt === null) return
    const updateClock = () => setNow(Date.now())
    const initialTimer = window.setTimeout(updateClock, 0)
    const timer = window.setInterval(updateClock, 1000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [status.currentStartedAt])

  const elapsed = status.currentStartedAt === null || now === 0
    ? null
    : Math.max(0, Math.floor((now - status.currentStartedAt) / 1000))
  const progress = status.currentProgress || 0

  return (
    <Panel title='Instrumental generation' contentClassName={styles.content}>
      <div>
        <div className={styles.grid}>
          <div>
            <span>Queued</span>
            <strong>{status.queuedSongs}</strong>
          </div>
          <div>
            <span>Completed this run</span>
            <strong>{status.completedSongs}</strong>
          </div>
          <div>
            <span>Average speed</span>
            <strong>{formatSpeed(status.averageSpeed)}</strong>
          </div>
        </div>
        <div className={styles.current}>
          <span>Currently processing</span>
          <strong title={status.currentSong || undefined}>
            {status.currentSong || (status.enabled ? 'Idle' : 'Disabled')}
          </strong>
          {status.currentSong && (
            <>
              <div
                className={styles.progressTrack}
                role='progressbar'
                aria-label='Instrumental generation progress'
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
              <small>
                {progress}
                % ·
                {' '}
                {Math.floor((elapsed || 0) / 60)}
                m
                {' '}
                {(elapsed || 0) % 60}
                s elapsed
              </small>
            </>
          )}
        </div>
        {status.lastError && (
          <div className={styles.error}>
            Last error:
            {status.lastError}
          </div>
        )}
        <div className={styles.actions}>
          <Button
            variant='primary'
            disabled={!status.enabled || isScanning}
            onClick={() => dispatch(requestScanAll())}
          >
            {isScanning ? 'Scanning media folders…' : 'Find single-track songs'}
          </Button>
          <small>
            Scans all media folders and queues only videos that contain one audio track.
          </small>
        </div>
        <div className={styles.history}>
          <h2>
            Processing history
            {status.recent.length > 0 && ` (${status.recent.length})`}
          </h2>
          {status.recent.length === 0 && <p>No processing history recorded yet.</p>}
          {status.recent.map((item) => {
            const speed = item.audioSeconds && item.processingSeconds
              ? `${(item.audioSeconds / item.processingSeconds).toFixed(2)}×`
              : null
            const when = item.completedAt || item.startedAt
            return (
              <div className={styles.historyItem} key={item.mediaId}>
                <div className={styles.historySong} title={item.song}>{item.song}</div>
                <div className={styles.historyMeta}>
                  <span className={styles[item.status]}>{item.status}</span>
                  {speed && (
                    <span>
                      {speed}
                      {' '}
                      realtime
                    </span>
                  )}
                  <span>
                    {item.attempts}
                    {' '}
                    {item.attempts === 1 ? 'attempt' : 'attempts'}
                  </span>
                  {when && <span>{new Date(when * 1000).toLocaleString()}</span>}
                </div>
                {item.error && <small className={styles.error}>{item.error}</small>}
              </div>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}

export default VocalSeparation
