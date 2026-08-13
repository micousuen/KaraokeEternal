import React, { useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import styles from './OverflowMarquee.css'

const MARQUEE_PX_PER_SECOND = 30

const OverflowMarquee = ({ className, text }: { className: string, text: string }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [distance, setDistance] = useState(0)

  useLayoutEffect(() => {
    const measure = () => {
      if (!containerRef.current || !textRef.current) return
      setDistance(Math.max(0, textRef.current.scrollWidth - containerRef.current.clientWidth))
    }
    const observer = new ResizeObserver(measure)
    if (containerRef.current) observer.observe(containerRef.current)
    if (textRef.current) observer.observe(textRef.current)
    measure()
    return () => observer.disconnect()
  }, [text])

  const movingFraction = 0.6
  const duration = distance > 0 ? distance / MARQUEE_PX_PER_SECOND / movingFraction : 0

  return (
    <div ref={containerRef} className={clsx(className, styles.marquee)}>
      <span
        ref={textRef}
        className={clsx(distance > 0 && styles.overflow)}
        style={{
          '--marquee-distance': `${distance}px`,
          '--marquee-duration': `${duration}s`,
        } as React.CSSProperties}
      >
        {text}
      </span>
    </div>
  )
}

export default OverflowMarquee
