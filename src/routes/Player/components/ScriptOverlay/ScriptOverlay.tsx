import React, { useEffect, useMemo, useState } from 'react'
import styles from './ScriptOverlay.css'

interface Cue {
  start: number
  end: number
  lines: string[]
  activeLine: number
  activeStart?: number
  activeEnd?: number
  activeWordStart?: number
  activeWordEnd?: number
}

const parseTime = (value: string): number => {
  const match = value.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/)
  if (!match) return 0
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

const parseSrt = (source: string): Cue[] => source.trim().split(/\r?\n\s*\r?\n/).flatMap((block) => {
  const lines = block.split(/\r?\n/)
  const timingIndex = lines.findIndex(line => line.includes('-->'))
  if (timingIndex === -1) return []
  const [start, rest] = lines[timingIndex].split('-->')
  // The generator appends `A<n>` after the timing arrow to identify the
  // currently-singing row. Legacy scripts without this marker default to 0.
  const activeMatch = rest.match(/\bA(\d+)\b/)
  // Generated scripts also carry the active word as a character range. Keeping
  // this metadata on the timing line leaves the lyric text itself valid SRT.
  const characterMatch = rest.match(/\bC(\d+)-(\d+)\b/)
  const progressMatch = rest.match(/\bP(\d+)-(\d+)\b/)
  return [{
    start: parseTime(start),
    end: parseTime(rest),
    lines: lines.slice(timingIndex + 1),
    activeLine: activeMatch ? Number(activeMatch[1]) : 0,
    activeStart: characterMatch ? Number(characterMatch[1]) : undefined,
    activeEnd: characterMatch ? Number(characterMatch[2]) : undefined,
    activeWordStart: progressMatch ? Number(progressMatch[1]) / 1000 : undefined,
    activeWordEnd: progressMatch ? Number(progressMatch[2]) / 1000 : undefined,
  }]
})

const renderLine = (line: string, lineIndex: number, cue: Cue, position: number) => {
  const isActive = lineIndex === cue.activeLine
  if (!isActive || cue.activeStart === undefined || cue.activeEnd === undefined) return line
  const start = Math.max(0, Math.min(line.length, cue.activeStart))
  const end = Math.max(0, Math.min(line.length, cue.activeEnd))
  const wordStart = cue.activeWordStart ?? cue.start
  const wordEnd = cue.activeWordEnd ?? cue.end
  const progress = wordEnd > wordStart
    ? Math.max(0, Math.min(1, (position - wordStart) / (wordEnd - wordStart)))
    : 1
  const currentWord = line.slice(start, end)
  return (
    <>
      <span className={styles.activeWord}>{line.slice(0, start)}</span>
      <span className={styles.currentWord}>
        {currentWord}
        <span
          className={styles.currentWordFill}
          style={{ width: `${progress * 100}%` }}
          aria-hidden='true'
        >
          {currentWord}
        </span>
      </span>
      {line.slice(end)}
    </>
  )
}

interface ScriptOverlayProps {
  isPlaying: boolean
  mediaId: number
  mediaKey: number
  position: number
}

const ScriptOverlay = ({ isPlaying, mediaId, mediaKey, position }: ScriptOverlayProps) => {
  const [loaded, setLoaded] = useState<{ mediaKey: number, cues: Cue[] }>({ mediaKey: -1, cues: [] })
  const [displayPosition, setDisplayPosition] = useState(position)

  useEffect(() => {
    const startedAt = performance.now()
    let frame = 0
    const update = () => {
      const nextPosition = isPlaying ? position + (performance.now() - startedAt) / 1000 : position
      setDisplayPosition(nextPosition)
      if (isPlaying) frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, mediaKey, position])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${document.baseURI}api/media/${mediaId}?type=script`, { signal: controller.signal })
      .then(response => response.ok ? response.text() : '')
      .then(text => setLoaded({ mediaKey, cues: text ? parseSrt(text) : [] }))
      .catch(() => {})
    return () => controller.abort()
  }, [mediaId, mediaKey])

  const cueIndex = useMemo(() => loaded.mediaKey === mediaKey
    ? loaded.cues.findIndex(cue => displayPosition >= cue.start && displayPosition < cue.end)
    : -1, [displayPosition, loaded, mediaKey])
  const cue = cueIndex === -1 ? undefined : loaded.cues[cueIndex]
  return cue
    ? (
        <div className={styles.script}>
          {cue.lines.map((line, index) => (
            <span
              key={`${index}-${line}`}
              className={index === cue.activeLine && cue.activeStart === undefined ? styles.activeLine : undefined}
            >
              {renderLine(line, index, cue, displayPosition)}
            </span>
          ))}
        </div>
      )
    : null
}

export default ScriptOverlay
