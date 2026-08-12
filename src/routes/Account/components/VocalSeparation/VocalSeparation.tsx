import React, { useEffect, useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
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
  const [openList, setOpenList] = useState<'queued' | 'completed' | null>(null)

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
    <Panel title='Media processing' contentClassName={styles.content}>
      <div>
        <div className={styles.grid}>
          <button className={styles.summaryButton} type='button' onClick={() => setOpenList('queued')}>
            <span>Queued</span>
            <strong>{status.queuedSongs}</strong>
          </button>
          <button className={styles.summaryButton} type='button' onClick={() => setOpenList('completed')}>
            <span>Completed this run</span>
            <strong>{status.completedSongs}</strong>
          </button>
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
              <div className={styles.taskList}>
                {status.currentTasks.map(task => (
                  <div key={task.type} className={styles.task}>
                    <span>{task.label}</span>
                    <small>{task.progress === null ? task.status : `${task.progress}%`}</small>
                    <div className={styles.taskTrack}>
                      <div
                        className={styles.taskFill}
                        data-active={task.progress === null}
                        style={{ width: task.progress === null ? '35%' : `${task.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div
                className={styles.progressTrack}
                role='progressbar'
                aria-label='Media processing progress'
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
            {isScanning ? 'Scanning media folders…' : 'Process media library'}
          </Button>
          <small>
            Scans media folders, adds an instrumental track when needed, and creates missing SRT scripts.
          </small>
        </div>
        {openList === 'queued' && (
          <Modal title={`Queued songs (${status.queued.length})`} onClose={() => setOpenList(null)} scrollable className={styles.listModal}>
            <div className={styles.songList}>
              {status.queued.length === 0 && <p>No songs are queued.</p>}
              {status.queued.map(item => (
                <div key={item.mediaId} title={item.song}>
                  <span>{item.song}</span>
                  <small>{item.tasks.map(task => task.label).join(' · ')}</small>
                </div>
              ))}
            </div>
          </Modal>
        )}
        {openList === 'completed' && (
          <Modal title={`Processing results (${status.recent.length})`} onClose={() => setOpenList(null)} scrollable className={styles.listModal}>
            <div className={styles.songList}>
              {status.recent.length === 0 && <p>No processing results recorded yet.</p>}
              {status.recent.map(item => (
                <div key={item.mediaId} title={item.song}>
                  <span>{item.song}</span>
                  <small>
                    {item.status}
                    {item.processingSeconds ? ` · ${Math.round(item.processingSeconds)}s` : ''}
                    {item.attempts > 1 ? ` · ${item.attempts} attempts` : ''}
                  </small>
                </div>
              ))}
            </div>
          </Modal>
        )}
      </div>
    </Panel>
  )
}

export default VocalSeparation
