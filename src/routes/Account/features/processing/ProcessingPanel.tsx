import React, { useEffect, useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import Panel from 'components/Panel/Panel'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { requestScanAll } from 'store/modules/prefs'
import {
  pauseVocalSeparation,
  resumeVocalSeparation,
} from 'store/modules/vocalSeparation'
import styles from './ProcessingPanel.css'
import HttpApi from 'lib/HttpApi'

const formatSpeed = (speed: number | null) => speed === null ? 'Waiting for first result' : `${speed.toFixed(2)}× realtime`
const formatStepSeconds = (seconds: number | null) => seconds === null ? '—' : `${seconds.toFixed(1)}s`
const api = new HttpApi()

interface BulkRegenerationResult {
  eligible: number
  queued: number
  skipped: number
  errors: string[]
}

const ProcessingPanel = () => {
  const status = useAppSelector(state => state.vocalSeparation)
  const isScanning = useAppSelector(state => state.prefs.isScanning)
  const dispatch = useAppDispatch()
  const [now, setNow] = useState(0)
  const [openList, setOpenList] = useState<'queued' | 'completed' | null>(null)
  const [isRegenerateOpen, setRegenerateOpen] = useState(false)
  const [isRegenerating, setRegenerating] = useState(false)
  const [regenerationError, setRegenerationError] = useState('')
  const [regenerationResult, setRegenerationResult] = useState<BulkRegenerationResult | null>(null)

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
  const handleRegenerateScripts = async () => {
    setRegenerating(true)
    setRegenerationError('')
    try {
      const result = await api.post<BulkRegenerationResult>('library/scripts/regenerate')
      setRegenerationResult(result)
      setRegenerateOpen(false)
    } catch (err) {
      setRegenerationError(err instanceof Error ? err.message : String(err))
    } finally {
      setRegenerating(false)
    }
  }
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
            <strong>{status.completedThisRun.length}</strong>
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
              <small>
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
        <div className={styles.secondaryActions}>
          <Button
            variant={status.isPaused ? 'primary' : 'default'}
            disabled={!status.enabled || (!status.isPaused && !status.currentSong && status.queuedSongs === 0)}
            onClick={() => dispatch(status.isPaused ? resumeVocalSeparation() : pauseVocalSeparation())}
          >
            {status.isPaused ? 'Resume processing' : 'Stop processing'}
          </Button>
        </div>
        <div className={styles.bulkAction}>
          <Button
            variant='default'
            disabled={!status.enabled || isRegenerating}
            onClick={() => {
              setRegenerationError('')
              setRegenerateOpen(true)
            }}
          >
            {isRegenerating ? 'Queuing existing scripts…' : 'Regenerate existing scripts'}
          </Button>
        </div>
        {regenerationResult && (
          <div className={styles.bulkResult} role='status'>
            {`Queued ${regenerationResult.queued} of ${regenerationResult.eligible} existing scripts.`}
            {regenerationResult.skipped > 0 && ` ${regenerationResult.skipped} skipped.`}
            {regenerationResult.errors.length > 0 && ` ${regenerationResult.errors[0]}`}
          </div>
        )}
        <div className={styles.primaryAction}>
          <Button
            variant='primary'
            disabled={!status.enabled || isScanning}
            onClick={() => dispatch(requestScanAll())}
          >
            {isScanning ? 'Scanning media folders…' : 'Process media library'}
          </Button>
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
          <Modal title={`Completed this run (${status.completedThisRun.length})`} onClose={() => setOpenList(null)} scrollable className={styles.listModal}>
            <div className={styles.songList}>
              {status.completedThisRun.length === 0 && <p>No songs completed during this server run.</p>}
              {status.completedThisRun.map(item => (
                <div key={item.mediaId} className={styles.resultItem}>
                  <div className={styles.resultSummary} title={item.song}>
                    <span>{item.song}</span>
                    <small>
                      {item.status}
                      {item.processingSeconds ? ` · ${Math.round(item.processingSeconds)}s` : ''}
                      {item.attempts > 1 ? ` · ${item.attempts} attempts` : ''}
                    </small>
                  </div>
                  {item.error && (
                    <details className={styles.errorDetails}>
                      <summary>Show failure details</summary>
                      <pre>{item.error}</pre>
                    </details>
                  )}
                  {(item.vadSeconds !== null || item.transcribeSeconds !== null || item.alignSeconds !== null) && (
                    <details className={styles.timingDetails}>
                      <summary>Show step timings</summary>
                      <dl className={styles.timingList}>
                        <div>
                          <dt>VAD</dt>
                          <dd>{formatStepSeconds(item.vadSeconds)}</dd>
                        </div>
                        <div>
                          <dt>Transcribe</dt>
                          <dd>{formatStepSeconds(item.transcribeSeconds)}</dd>
                        </div>
                        <div>
                          <dt>Align</dt>
                          <dd>{formatStepSeconds(item.alignSeconds)}</dd>
                        </div>
                      </dl>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </Modal>
        )}
        {isRegenerateOpen && (
          <Modal title='Regenerate existing scripts' onClose={() => !isRegenerating && setRegenerateOpen(false)}>
            <p>
              This queues every song that already has an SRT script. Vocal separation and scripting will run again,
              and each existing script will only be replaced after its new script succeeds.
            </p>
            {regenerationError && <div className={styles.error} role='alert'>{regenerationError}</div>}
            <div className={styles.modalActions}>
              <Button variant='primary' disabled={isRegenerating} onClick={handleRegenerateScripts}>
                {isRegenerating ? 'Queuing…' : 'Regenerate all existing scripts'}
              </Button>
              <Button disabled={isRegenerating} onClick={() => setRegenerateOpen(false)}>Cancel</Button>
            </div>
          </Modal>
        )}
      </div>
    </Panel>
  )
}

export default ProcessingPanel
