import React, { useEffect, useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import Panel from 'components/Panel/Panel'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { requestScanAll } from 'store/modules/prefs'
import {
  resumeVocalSeparation,
  retryVocalSeparation,
  stopVocalSeparation,
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

type BulkOutput = 'script' | 'instrumental' | 'name'

interface BulkActionConfig {
  output: BulkOutput
  button: string
  title: string
  description: string
  confirm: string
  pending: string
  result: (result: BulkRegenerationResult) => string
}

const BULK_ACTIONS: BulkActionConfig[] = [
  {
    output: 'script',
    button: 'Regenerate scripts',
    title: 'Regenerate scripts',
    description: 'This queues every YouTube download that already has an SRT script. Vocal separation and scripting will run again, and each existing script will only be replaced after its new script succeeds.',
    confirm: 'Regenerate all scripts',
    pending: 'Queuing scripts…',
    result: result => `Queued ${result.queued} of ${result.eligible} YouTube downloads.`,
  },
  {
    output: 'instrumental',
    button: 'Regenerate instrumentals',
    title: 'Regenerate instrumentals',
    description: 'This queues every YouTube download for vocal separation. Each existing instrumental track will only be replaced after its new track succeeds.',
    confirm: 'Regenerate all instrumentals',
    pending: 'Queuing instrumentals…',
    result: result => `Queued ${result.queued} of ${result.eligible} YouTube downloads.`,
  },
  {
    output: 'name',
    button: 'Reparse filenames',
    title: 'Reparse downloaded filenames',
    description: 'The artist and song title of every YouTube download that still carries its original YouTube filename will be extracted with DeepSeek and renamed to the Artist-Title format used across the library.',
    confirm: 'Reparse all filenames',
    pending: 'Reparsing filenames…',
    result: result => `Renamed ${result.queued} of ${result.eligible} YouTube downloads.`,
  },
]

const ProcessingPanel = () => {
  const status = useAppSelector(state => state.vocalSeparation)
  const isScanning = useAppSelector(state => state.prefs.isScanning)
  const isDeepSeekConfigured = useAppSelector(state => state.prefs.isDeepSeekApiKeyConfigured)
  const dispatch = useAppDispatch()
  const [now, setNow] = useState(0)
  const [openList, setOpenList] = useState<'queued' | 'completed' | null>(null)
  const [bulkOutput, setBulkOutput] = useState<BulkOutput | null>(null)
  const [isRegenerating, setRegenerating] = useState(false)
  const [regenerationError, setRegenerationError] = useState('')
  const [regenerationResult, setRegenerationResult] = useState<{ output: BulkOutput, result: BulkRegenerationResult } | null>(null)
  const bulkAction = BULK_ACTIONS.find(action => action.output === bulkOutput) || null

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
  const handleRegenerate = async (output: BulkOutput) => {
    setRegenerating(true)
    setRegenerationError('')
    try {
      const result = await api.post<BulkRegenerationResult>('library/downloads/regenerate', { body: { output } })
      setRegenerationResult({ output, result })
      setBulkOutput(null)
    } catch (err) {
      setRegenerationError(err instanceof Error ? err.message : String(err))
    } finally {
      setRegenerating(false)
    }
  }
  const isBulkDisabled = (output: BulkOutput): boolean => {
    if (isRegenerating) return true
    if (output === 'name') return !isDeepSeekConfigured
    return !status.enabled
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
            onClick={() => dispatch(status.isPaused ? resumeVocalSeparation() : stopVocalSeparation())}
          >
            {status.isPaused ? 'Resume processing' : 'Stop processing'}
          </Button>
        </div>
        <div className={styles.bulkActions}>
          {BULK_ACTIONS.map(action => (
            <Button
              key={action.output}
              variant='default'
              disabled={isBulkDisabled(action.output)}
              title={action.output === 'name' && !isDeepSeekConfigured
                ? 'Configure a DeepSeek API key in Preferences first'
                : undefined}
              onClick={() => {
                setRegenerationError('')
                setBulkOutput(action.output)
              }}
            >
              {action.button}
            </Button>
          ))}
        </div>
        {regenerationResult && (
          <div className={styles.bulkResult} role='status'>
            {BULK_ACTIONS.find(action => action.output === regenerationResult.output)
              ?.result(regenerationResult.result)}
            {regenerationResult.result.skipped > 0 && ` ${regenerationResult.result.skipped} skipped.`}
            {regenerationResult.result.errors.length > 0 && ` ${regenerationResult.result.errors[0]}`}
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
                  {(item.status === 'failed' || item.status === 'interrupted') && (
                    <button
                      type='button'
                      className={styles.rerun}
                      onClick={() => dispatch(retryVocalSeparation({ mediaId: item.mediaId }))}
                    >
                      Rerun
                    </button>
                  )}
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
        {bulkAction && (
          <Modal title={bulkAction.title} onClose={() => !isRegenerating && setBulkOutput(null)}>
            <p>{bulkAction.description}</p>
            {regenerationError && <div className={styles.error} role='alert'>{regenerationError}</div>}
            <div className={styles.modalActions}>
              <Button variant='primary' disabled={isRegenerating} onClick={() => void handleRegenerate(bulkAction.output)}>
                {isRegenerating ? bulkAction.pending : bulkAction.confirm}
              </Button>
              <Button disabled={isRegenerating} onClick={() => setBulkOutput(null)}>Cancel</Button>
            </div>
          </Modal>
        )}
      </div>
    </Panel>
  )
}

export default ProcessingPanel
