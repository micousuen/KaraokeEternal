import React, { useEffect, useMemo, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import { useAppSelector } from 'store/hooks'
import { BROWSER_MEDIA_VERSION, codecMediaType, type SourceMediaInfo } from 'shared/media'
import {
  createRollingSrt,
  parseKaraokeWords,
  rollingCues,
  wordsToTranscript,
  type KaraokeWord,
  type RollingCue,
} from 'shared/subtitleFormat'
import Waveform, { type AudioPeaks } from './Waveform'
import styles from './ScriptEditor.css'

const api = new HttpApi()
const MAX_LINE_WIDTH = 36
const MIN_LINE_WIDTH = 12
const PEAK_BUCKETS = 2000

interface EditorWord extends KaraokeWord {
  id: number
}

interface ScriptEditorModalProps {
  songId: number
  title: string
  artist: string
  onClose(): void
}

const formatTime = (seconds: number) => {
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}.${String(Math.floor((seconds % 1) * 100)).padStart(2, '0')}`
}

const ScriptEditorModal = ({ songId, title, artist, onClose }: ScriptEditorModalProps) => {
  const song = useAppSelector(state => state.songs.entities[songId])
  const [mediaId, setMediaId] = useState<number | null>(null)
  const [words, setWords] = useState<EditorWord[]>([])
  const [language, setLanguage] = useState('en')
  const [status, setStatus] = useState('Loading…')
  const [error, setError] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [peaks, setPeaks] = useState<AudioPeaks | null>(null)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setPlaying] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [isDirty, setDirty] = useState(false)
  const [isSaving, setSaving] = useState(false)
  const [hasScript, setHasScript] = useState(true)
  const audioRef = useRef<HTMLAudioElement>(null)
  const stopAtRef = useRef<number | null>(null)
  const nextWordId = useRef(1)
  const audioCtxRef = useRef<AudioContext | null>(null)

  // Resolve the preferred media, its script, and an audible track.
  useEffect(() => {
    let canceled = false
    const load = async () => {
      try {
        const mediaList = await api.get<{ result: number[], entities: Record<number, { isPreferred: boolean | number, mediaId: number, relPath: string }> }>(`song/${songId}`)
        if (canceled) return
        const preferredId = mediaList.result.find(id => !!mediaList.entities[id].isPreferred)
        const chosenId = preferredId !== undefined ? preferredId : mediaList.result[0]
        if (chosenId === undefined) {
          setStatus('')
          setError('This song has no media files.')
          return
        }
        setMediaId(chosenId)

        const scriptResponse = await fetch(`${document.baseURI}api/media/${chosenId}?type=script`)
        const scriptText = scriptResponse.ok ? await scriptResponse.text() : ''
        if (canceled) return
        setHasScript(!!scriptText)
        const parsed = parseKaraokeWords(scriptText)
        setWords(parsed.map(word => ({ ...word, id: nextWordId.current++ })))
        if (scriptText && !parsed.length) {
          setError('This script has no per-word timings; edit the words below and save to regenerate it.')
        }

        const infoResponse = await fetch(`${document.baseURI}api/media/${chosenId}?type=videoInfo&v=${BROWSER_MEDIA_VERSION}`)
        if (!infoResponse.ok) throw new Error('Could not read media info')
        const info = await infoResponse.json() as SourceMediaInfo
        if (canceled) return
        const track = info.audioTracks[0]
        const canStreamSource = !!track
          && !!codecMediaType(track.mimeType, track.codec)
          && new Audio().canPlayType(codecMediaType(track.mimeType, track.codec)!) !== ''
        const audioType = canStreamSource ? 'sourceAudio' : 'videoAudio'
        const audioFetch = await fetch(
          `${document.baseURI}api/media/${chosenId}?type=${audioType}&audioTrack=0&v=${BROWSER_MEDIA_VERSION}`,
        )
        if (!audioFetch.ok) throw new Error('Could not load audio')
        const blob = await audioFetch.blob()
        if (canceled) return
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)

        try {
          const buffer = await blob.arrayBuffer()
          const audioCtx = new AudioContext()
          audioCtxRef.current = audioCtx
          const decoded = await audioCtx.decodeAudioData(buffer)
          if (canceled) return
          setPeaks(computePeaks(decoded))
          setDuration(decoded.duration)
        } catch {
          // The element can usually still play what decodeAudioData rejects.
        }
        setStatus('')
      } catch (err) {
        if (!canceled) {
          setStatus('')
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }
    void load()
    return () => {
      canceled = true
    }
  }, [songId])

  useEffect(() => {
    if (song?.language) setLanguage(song.language)
  }, [song])

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    void audioCtxRef.current?.close()
  }, [audioUrl])

  const cues = useMemo<RollingCue[]>(
    () => rollingCues(wordsToTranscript(words), language, MAX_LINE_WIDTH, MIN_LINE_WIDTH),
    [language, words],
  )

  const updateWord = (index: number, changes: Partial<KaraokeWord>) => {
    setWords(current => current.map((word, i) => i === index ? { ...word, ...changes } : word))
    setDirty(true)
  }

  const handleWordTimeChange = (index: number, start: number, end: number) => {
    updateWord(index, { start, end })
  }

  const seek = (time: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = time
    stopAtRef.current = null
  }

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    stopAtRef.current = null
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  const playWord = (word: KaraokeWord) => {
    const audio = audioRef.current
    if (!audio) return
    stopAtRef.current = word.end
    audio.currentTime = word.start
    void audio.play()
  }

  const insertWordAfter = (index: number) => {
    const anchor = words[index]
    const start = anchor ? anchor.end : (audioRef.current?.currentTime || 0)
    setWords((current) => {
      const next = [...current]
      next.splice(index + 1, 0, { id: nextWordId.current++, text: '', start, end: start + 0.5 })
      return next
    })
    setSelectedIndex(index + 1)
    setDirty(true)
  }

  const deleteWord = (index: number) => {
    setWords((current) => {
      const next = [...current]
      next.splice(index, 1)
      return next
    })
    if (selectedIndex === index) setSelectedIndex(null)
    setDirty(true)
  }

  const handleSave = async () => {
    if (mediaId === null) return
    const transcript = wordsToTranscript(words)
    if (!transcript.length) {
      setError('Add at least one timed word before saving.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const script = createRollingSrt(transcript, language, MAX_LINE_WIDTH, MIN_LINE_WIDTH)
      await api.put(`media/${mediaId}/script`, { body: { script } })
      setHasScript(true)
      setDirty(false)
      setStatus('Saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Edit script — ${artist} - ${title}`} onClose={onClose} className={styles.modal}>
      <div className={styles.layout}>
        {status && <div className={styles.status} role='status'>{status}</div>}
        {error && <div className={styles.error} role='alert'>{error}</div>}
        {!hasScript && !error && (
          <div className={styles.notice}>This song has no script yet; add words below and save to create one.</div>
        )}

        <Waveform
          audioRef={audioRef}
          duration={duration}
          peaks={peaks}
          words={words}
          selectedIndex={selectedIndex}
          onSeek={seek}
          onWordTimeChange={handleWordTimeChange}
        />

        <div className={styles.transport}>
          <Button variant='primary' disabled={!audioUrl} onClick={togglePlay}>
            {isPlaying ? 'Pause' : 'Play'}
          </Button>
          <span className={styles.position}><LivePosition audioRef={audioRef} /></span>
          <label className={styles.language}>
            Language
            <input
              value={language}
              onChange={(event) => {
                setLanguage(event.currentTarget.value)
                setDirty(true)
              }}
              title='Language code; ja/zh/ko/th join words without spaces'
            />
          </label>
        </div>

        <KaraokePreview audioRef={audioRef} cues={cues} />

        <div className={styles.wordList}>
          {words.map((word, index) => (
            <div
              key={word.id}
              className={index === selectedIndex ? styles.wordRowSelected : styles.wordRow}
              onClick={() => setSelectedIndex(index)}
            >
              <span className={styles.wordIndex}>{index + 1}</span>
              <input
                className={styles.wordText}
                value={word.text}
                placeholder='word'
                onChange={event => updateWord(index, { text: event.currentTarget.value })}
                onClick={event => event.stopPropagation()}
              />
              <TimeInput
                value={word.start}
                onCommit={value => updateWord(index, { start: Math.min(value, word.end - 0.01) })}
              />
              <TimeInput
                value={word.end}
                onCommit={value => updateWord(index, { end: Math.max(value, word.start + 0.01) })}
              />
              <span className={styles.wordDuration}>
                {(word.end - word.start).toFixed(2)}
                s
              </span>
              <button
                type='button'
                className={styles.wordButton}
                title='Set start at playhead'
                onClick={() => updateWord(index, {
                  start: Math.min(audioRef.current?.currentTime ?? 0, word.end - 0.01),
                })}
              >
                ⇤
              </button>
              <button
                type='button'
                className={styles.wordButton}
                title='Set end at playhead'
                onClick={() => updateWord(index, {
                  end: Math.max(audioRef.current?.currentTime ?? 0, word.start + 0.01),
                })}
              >
                ⇥
              </button>
              <button
                type='button'
                className={styles.wordButton}
                title='Play this word'
                onClick={() => playWord(word)}
              >
                ▸
              </button>
              <button
                type='button'
                className={styles.wordButton}
                title='Insert a word after this one'
                onClick={() => insertWordAfter(index)}
              >
                +
              </button>
              <button
                type='button'
                className={styles.wordButton}
                title='Delete this word'
                onClick={() => deleteWord(index)}
              >
                ×
              </button>
            </div>
          ))}
          <button type='button' className={styles.addWord} onClick={() => insertWordAfter(words.length - 1)}>
            Add word
          </button>
        </div>

        <div className={styles.footer}>
          <span className={styles.dirty}>{isDirty ? 'Unsaved changes' : ''}</span>
          <Button variant='primary' disabled={isSaving || mediaId === null} onClick={() => void handleSave()}>
            {isSaving ? 'Saving…' : 'Save script'}
          </Button>
          <Button disabled={isSaving} onClick={onClose}>Close</Button>
        </div>
      </div>
      <audio
        preload='auto'
        src={audioUrl || undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget
          if (stopAtRef.current !== null && audio.currentTime >= stopAtRef.current) {
            audio.pause()
            stopAtRef.current = null
          }
        }}
        onLoadedMetadata={(event) => {
          if (!duration && Number.isFinite(event.currentTarget.duration)) {
            setDuration(event.currentTarget.duration)
          }
        }}
        ref={audioRef}
      />
    </Modal>
  )
}

const LivePosition = ({ audioRef }: { audioRef: React.RefObject<HTMLAudioElement | null> }) => {
  const [text, setText] = useState('0:00.00')
  useEffect(() => {
    let frame = 0
    const update = () => {
      const current = audioRef.current?.currentTime || 0
      setText(`${formatTime(current)}${audioRef.current?.duration && Number.isFinite(audioRef.current.duration) ? ` / ${formatTime(audioRef.current.duration)}` : ''}`)
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [audioRef])
  return <>{text}</>
}

const KaraokePreview = ({
  audioRef,
  cues,
}: {
  audioRef: React.RefObject<HTMLAudioElement | null>
  cues: RollingCue[]
}) => {
  const [position, setPosition] = useState(-1)
  useEffect(() => {
    let frame = 0
    const update = () => {
      const current = audioRef.current?.currentTime ?? -1
      setPosition(previous => Math.abs(previous - current) > 0.03 ? current : previous)
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [audioRef])

  const cue = cues.find(candidate => position >= candidate.start && position < candidate.end)
  return (
    <div className={styles.preview}>
      {cue
        ? cue.text.split('\n').map((line, index) => {
            const isActive = index === cue.activeRow
            const from = isActive ? Math.max(0, Math.min(line.length, cue.activeStart)) : 0
            const to = isActive ? Math.max(0, Math.min(line.length, cue.activeEnd)) : 0
            const currentWord = line.slice(from, to)
            const progress = cue.activeWordEnd > cue.activeWordStart
              ? Math.max(0, Math.min(1, (position - cue.activeWordStart) / (cue.activeWordEnd - cue.activeWordStart)))
              : 1
            return (
              <div key={index} className={index === cue.activeRow ? styles.previewActiveLine : styles.previewLine}>
                <span className={styles.previewSung}>{line.slice(0, from)}</span>
                <span className={styles.previewWord}>
                  {currentWord}
                  <span className={styles.previewFill} style={{ width: `${progress * 100}%` }} aria-hidden='true'>
                    {currentWord}
                  </span>
                </span>
                {line.slice(to)}
              </div>
            )
          })
        : <div className={styles.previewLine}>—</div>}
    </div>
  )
}

const TimeInput = ({ value, onCommit }: { value: number, onCommit(value: number): void }) => {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? value.toFixed(2)
  return (
    <input
      className={styles.timeInput}
      value={shown}
      inputMode='decimal'
      title='Seconds'
      onChange={(event) => {
        setDraft(event.currentTarget.value)
        const parsed = Number.parseFloat(event.currentTarget.value)
        if (Number.isFinite(parsed) && parsed >= 0) onCommit(parsed)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

function computePeaks (buffer: AudioBuffer): AudioPeaks {
  const channel = buffer.getChannelData(0)
  const bucketSize = Math.max(1, Math.floor(channel.length / PEAK_BUCKETS))
  const buckets = Math.max(1, Math.ceil(channel.length / bucketSize))
  const min = new Float32Array(buckets)
  const max = new Float32Array(buckets)
  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = bucket * bucketSize
    const to = Math.min(channel.length, from + bucketSize)
    let low = 0
    let high = 0
    for (let i = from; i < to; i++) {
      const sample = channel[i]
      if (sample < low) low = sample
      if (sample > high) high = sample
    }
    min[bucket] = low
    max[bucket] = high
  }
  return { min, max }
}

export default ScriptEditorModal
