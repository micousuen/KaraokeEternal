import React, { useEffect, useMemo, useState } from 'react'
import styles from './ScriptOverlay.css'

interface Cue { start: number, end: number, lines: string[] }

const parseTime = (value: string): number => {
  const match = value.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/)
  if (!match) return 0
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

const parseSrt = (source: string): Cue[] => source.trim().split(/\r?\n\s*\r?\n/).flatMap((block) => {
  const lines = block.split(/\r?\n/)
  const timingIndex = lines.findIndex(line => line.includes('-->'))
  if (timingIndex === -1) return []
  const [start, end] = lines[timingIndex].split('-->')
  return [{ start: parseTime(start), end: parseTime(end), lines: lines.slice(timingIndex + 1) }]
})

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
  // Each generated cue ends when its currently sung row finishes. Every later
  // rolling cue retains that row at the same index, so compare it to the prior
  // cue to find the active line without adding custom markup to the SRT file.
  const retainedLine = cueIndex <= 0 || !cue
    ? -1
    : cue.lines.findIndex((line, index) => line === loaded.cues[cueIndex - 1].lines[index])
  const activeLine = retainedLine === -1
    ? 0
    : retainedLine
  return cue
    ? (
        <div className={styles.script}>
          {cue.lines.map((line, index) => (
            <span key={`${index}-${line}`} className={index === activeLine ? styles.activeLine : undefined}>{line}</span>
          ))}
        </div>
      )
    : null
}

export default ScriptOverlay
