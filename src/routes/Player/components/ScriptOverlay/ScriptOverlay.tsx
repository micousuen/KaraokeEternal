import React, { useEffect, useMemo, useState } from 'react'
import styles from './ScriptOverlay.css'

interface Cue {
  start: number
  end: number
  lines: string[]
  activeLine: number
  activeStart?: number
  activeEnd?: number
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
  return [{
    start: parseTime(start),
    end: parseTime(rest),
    lines: lines.slice(timingIndex + 1),
    activeLine: activeMatch ? Number(activeMatch[1]) : 0,
    activeStart: characterMatch ? Number(characterMatch[1]) : undefined,
    activeEnd: characterMatch ? Number(characterMatch[2]) : undefined,
  }]
})

const renderLine = (line: string, lineIndex: number, cue: Cue) => {
  const isActive = lineIndex === cue.activeLine
  if (!isActive || cue.activeStart === undefined || cue.activeEnd === undefined) return line
  const end = Math.max(0, Math.min(line.length, cue.activeEnd))
  return (
    <>
      <span className={styles.activeWord}>{line.slice(0, end)}</span>
      {line.slice(end)}
    </>
  )
}

const ScriptOverlay = ({ mediaId, mediaKey, position }: { mediaId: number, mediaKey: number, position: number }) => {
  const [loaded, setLoaded] = useState<{ mediaKey: number, cues: Cue[] }>({ mediaKey: -1, cues: [] })

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${document.baseURI}api/media/${mediaId}?type=script`, { signal: controller.signal })
      .then(response => response.ok ? response.text() : '')
      .then(text => setLoaded({ mediaKey, cues: text ? parseSrt(text) : [] }))
      .catch(() => {})
    return () => controller.abort()
  }, [mediaId, mediaKey])

  const cueIndex = useMemo(() => loaded.mediaKey === mediaKey
    ? loaded.cues.findIndex(cue => position >= cue.start && position <= cue.end)
    : -1, [loaded, mediaKey, position])
  const cue = cueIndex === -1 ? undefined : loaded.cues[cueIndex]
  return cue
    ? (
        <div className={styles.script}>
          {cue.lines.map((line, index) => (
            <span
              key={`${index}-${line}`}
              className={index === cue.activeLine && cue.activeStart === undefined ? styles.activeLine : undefined}
            >
              {renderLine(line, index, cue)}
            </span>
          ))}
        </div>
      )
    : null
}

export default ScriptOverlay
