import React, { useCallback, useEffect, useRef } from 'react'
import type { KaraokeWord } from 'shared/subtitleFormat'
import styles from './ScriptEditor.css'

export interface AudioPeaks {
  min: Float32Array
  max: Float32Array
}

interface WaveformProps {
  audioRef: React.RefObject<HTMLAudioElement | null>
  duration: number
  peaks: AudioPeaks | null
  words: KaraokeWord[]
  selectedIndex: number | null
  onSeek(time: number): void
  onWordTimeChange(index: number, start: number, end: number): void
}

const WAVE_HEIGHT = 96
const REGION_HEIGHT = 18
const HANDLE_PX = 7
const CANVAS_HEIGHT = WAVE_HEIGHT + REGION_HEIGHT

const Waveform = ({
  audioRef,
  duration,
  peaks,
  words,
  selectedIndex,
  onSeek,
  onWordTimeChange,
}: WaveformProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(0)
  const dragRef = useRef<{ mode: 'seek' | 'start' | 'end', wordIndex: number } | null>(null)

  const timeAt = useCallback((offsetX: number): number => {
    const width = widthRef.current
    if (!width || !duration) return 0
    return Math.max(0, Math.min(duration, (offsetX / width) * duration))
  }, [duration])

  const xAt = useCallback((time: number): number => {
    const width = widthRef.current
    if (!width || !duration) return 0
    return (time / duration) * width
  }, [duration])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const width = widthRef.current
    if (!width) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(CANVAS_HEIGHT * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(CANVAS_HEIGHT * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, CANVAS_HEIGHT)

    // waveform
    const mid = WAVE_HEIGHT / 2
    if (peaks) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
      const buckets = peaks.min.length
      for (let x = 0; x < width; x++) {
        const bucket = Math.min(buckets - 1, Math.floor((x / width) * buckets))
        const min = peaks.min[bucket]
        const max = peaks.max[bucket]
        const top = mid - max * (WAVE_HEIGHT / 2 - 2)
        const bottom = mid - min * (WAVE_HEIGHT / 2 - 2)
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top))
      }
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(width, mid)
      ctx.stroke()
    }

    // word timing regions
    const regionTop = WAVE_HEIGHT + 2
    words.forEach((word, index) => {
      const x1 = xAt(word.start)
      const x2 = Math.max(x1 + 2, xAt(word.end))
      ctx.fillStyle = index === selectedIndex
        ? 'hsla(215, 90%, 65%, 0.9)'
        : 'hsla(215, 60%, 55%, 0.35)'
      ctx.fillRect(x1, regionTop, x2 - x1, REGION_HEIGHT - 4)
      if (index === selectedIndex) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.fillRect(x1 - 1, regionTop - 2, 2, REGION_HEIGHT)
        ctx.fillRect(x2 - 1, regionTop - 2, 2, REGION_HEIGHT)
      }
    })

    // playhead
    const current = audioRef.current?.currentTime || 0
    if (duration) {
      const x = xAt(current)
      ctx.fillStyle = '#ff5a5a'
      ctx.fillRect(x - 1, 0, 2, CANVAS_HEIGHT)
    }
  }, [audioRef, duration, peaks, selectedIndex, words, xAt])

  useEffect(() => {
    let frame = 0
    const render = () => {
      draw()
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [draw])

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) widthRef.current = containerRef.current.clientWidth
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const selectedWord = selectedIndex !== null ? words[selectedIndex] : undefined

  const hitTest = (offsetX: number): 'start' | 'end' | null => {
    if (!selectedWord || selectedIndex === null) return null
    const x1 = xAt(selectedWord.start)
    const x2 = xAt(selectedWord.end)
    if (Math.abs(offsetX - x1) <= HANDLE_PX) return 'start'
    if (Math.abs(offsetX - x2) <= HANDLE_PX) return 'end'
    return null
  }

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const edge = hitTest(offsetX)
    if (edge && selectedIndex !== null) {
      dragRef.current = { mode: edge, wordIndex: selectedIndex }
    } else {
      dragRef.current = { mode: 'seek', wordIndex: -1 }
      onSeek(timeAt(offsetX))
    }
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    if (!drag) {
      event.currentTarget.style.cursor = hitTest(offsetX) ? 'ew-resize' : 'crosshair'
      return
    }
    const time = timeAt(offsetX)
    if (drag.mode === 'seek') {
      onSeek(time)
      return
    }
    const word = words[drag.wordIndex]
    if (!word) return
    if (drag.mode === 'start') {
      onWordTimeChange(drag.wordIndex, Math.min(time, word.end - 0.01), word.end)
    } else {
      onWordTimeChange(drag.wordIndex, word.start, Math.max(time, word.start + 0.01))
    }
  }

  const endDrag = () => {
    dragRef.current = null
  }

  return (
    <div className={styles.waveformContainer} ref={containerRef}>
      <canvas
        className={styles.waveformCanvas}
        style={{ height: CANVAS_HEIGHT }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        ref={canvasRef}
      />
    </div>
  )
}

export default Waveform
