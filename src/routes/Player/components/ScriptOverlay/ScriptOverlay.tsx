import React, { useEffect, useMemo, useState } from 'react'
import styles from './ScriptOverlay.css'

interface Cue { start: number, end: number, text: string }

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
  return [{ start: parseTime(start), end: parseTime(end), text: lines.slice(timingIndex + 1).join('\n') }]
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

  const text = useMemo(() => loaded.mediaKey === mediaKey
    ? loaded.cues.find(cue => position >= cue.start && position <= cue.end)?.text
    : undefined, [loaded, mediaKey, position])
  return text ? <div className={styles.script}>{text}</div> : null
}

export default ScriptOverlay
