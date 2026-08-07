import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import clsx from 'clsx'
import { useSwipeable } from 'react-swipeable'
import { useLongPress } from 'use-long-press'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import ButtonStar from 'components/ButtonStar/ButtonStar'
import Buttons from 'components/Buttons/Buttons'
import Icon from 'components/Icon/Icon'
import UserImage from 'components/UserImage/UserImage'
import { requestPlayNext, requestReplay } from 'store/modules/status'
import { showSongInfo } from 'store/modules/songInfo'
import { toggleSongStarred } from 'store/modules/userStars'
import { showErrorMessage } from 'store/modules/ui'
import { queueSong, removeItem } from '../../modules/queue'
import styles from './QueueItem.css'

const LONG_PRESS_THRESHOLD_MS = 700
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
        className={clsx(distance > 0 && styles.marqueeOverflow)}
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

interface QueueItemProps {
  artist: string
  dragHandleProps?: DraggableProvidedDragHandleProps | null
  errorMessage: string
  isCurrent: boolean
  isDragging: boolean
  isErrored: boolean
  isInfoable: boolean
  isMovable: boolean
  isOwner: boolean
  isPlayed: boolean
  isPlaying: boolean
  isRemovable: boolean
  isReplayable: boolean
  isSkippable: boolean
  isStarred: boolean
  isUpcoming: boolean
  pctPlayed: number
  queueId: number
  songId: number
  starCount: number
  title: string
  userDateUpdated: number
  userDisplayName: string
  userId: number
  // actions
  onPlayNextClick(queueId: number): void
  onRemoveUpcoming: (userId: number) => void
}

const QueueItem = ({
  artist,
  dragHandleProps,
  errorMessage,
  isCurrent,
  isDragging,
  isErrored,
  isInfoable,
  isMovable,
  isOwner,
  isPlayed,
  isPlaying,
  isRemovable,
  isReplayable,
  isSkippable,
  isStarred,
  isUpcoming,
  onPlayNextClick,
  onRemoveUpcoming,
  pctPlayed,
  queueId,
  songId,
  starCount,
  title,
  userDateUpdated,
  userDisplayName,
  userId,
}: QueueItemProps) => {
  const [isExpanded, setExpanded] = useState(false)
  const [isRequeued, setRequeued] = useState(false)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressActiveRef = useRef(false)
  const buttonWidth = useAppSelector(state => state.ui.innerWidth <= 600 ? 44 : 56)
  const dispatch = useAppDispatch()

  const handleErrorInfoClick = () => dispatch(showErrorMessage(errorMessage))
  const handleInfoClick = () => dispatch(showSongInfo(songId))
  const handlePlayNextClick = () => onPlayNextClick(queueId)
  const handleReplayClick = () => {
    dispatch(requestReplay(queueId))
    setExpanded(false)
  }
  const handleRequeueClick = () => {
    if (isRequeued) return
    setRequeued(true)
    dispatch(queueSong(songId))
    setExpanded(false)
    feedbackTimerRef.current = setTimeout(() => setRequeued(false), 2000)
  }
  const handleSkipClick = () => {
    dispatch(requestPlayNext())
    setExpanded(false)
  }
  const handleRemoveClick = () => dispatch(removeItem({ queueId }))
  const handleStarClick = () => dispatch(toggleSongStarred(songId))

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
  }, [])

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      setExpanded(isErrored || isInfoable || isRemovable || isSkippable)
    },
    onSwipedRight: () => setExpanded(false),
    preventScrollOnSwipe: true,
    trackMouse: true,
  })

  const bindRemovePressHandlers = useLongPress(() => {
    const confirmText = isOwner ? 'Remove all your upcoming songs?' : `Remove all upcoming songs for "${userDisplayName}"?`
    longPressActiveRef.current = true

    if (confirm(confirmText)) {
      onRemoveUpcoming(userId)
    }
  }, { threshold: LONG_PRESS_THRESHOLD_MS, cancelOnMovement: true })

  const bindSkipPressHandlers = useLongPress(() => {
    const confirmText = isOwner ? 'Skip and remove all your upcoming songs?' : `Skip and remove all upcoming songs for "${userDisplayName}"?`
    longPressActiveRef.current = true

    if (confirm(confirmText)) {
      onRemoveUpcoming(userId)
      handleSkipClick()
    }
  }, { threshold: LONG_PRESS_THRESHOLD_MS, cancelOnMovement: true })

  return (
    <div
      {...swipeHandlers}
      className={clsx(
        styles.container,
        isCurrent && styles.current,
        isCurrent && !isPlaying && styles.paused,
        isDragging && styles.dragging,
      )}
      style={{ '--progress': (isCurrent && pctPlayed < 2 ? 2 : pctPlayed) + '%' } as React.CSSProperties}
    >
      <div className={styles.content}>
        {isMovable && (
          <div {...dragHandleProps} className={styles.dragHandle} aria-label='Reorder queue item'>
            <Icon icon='DRAG_INDICATOR' />
          </div>
        )}
        <div className={clsx(styles.imageContainer, isPlayed && styles.greyed)}>
          <UserImage userId={userId} dateUpdated={userDateUpdated} />
        </div>

        <div className={clsx(styles.primary, isPlayed && styles.greyed)} translate='no'>
          <div className={styles.innerPrimary}>
            <OverflowMarquee className={styles.title} text={title} />
            <OverflowMarquee className={styles.artist} text={artist} />
          </div>
          <div className={clsx(styles.user, isOwner && styles.isOwner)}>
            {userDisplayName}
          </div>
        </div>

        <Buttons btnWidth={buttonWidth} isExpanded={isExpanded} className={styles.btnContainer}>
          {isErrored && (
            <Button
              className={styles.danger}
              icon='INFO_OUTLINE'
              onClick={handleErrorInfoClick}
            />
          )}
          {isMovable && (
            <Button
              className={styles.btnPriority}
              icon='PLAY_NEXT'
              onClick={handlePlayNextClick}
              title='Move to top and play next'
              aria-label='Move to top and play next'
            />
          )}
          <ButtonStar
            className={styles.btnStar}
            isStarred={isStarred}
            onClick={handleStarClick}
            count={starCount}
          />
          {isRemovable && (
            <Button
              className={clsx(styles.btnRemove, styles.danger)}
              icon='DELETE'
              title='Delete from queue'
              aria-label='Delete from queue'
              onTouchEnd={(e: React.TouchEvent<HTMLButtonElement>) => {
                if (longPressActiveRef.current) {
                  e.preventDefault()
                  e.stopPropagation()
                  longPressActiveRef.current = false
                }
              }}
              onClick={() => {
                if (longPressActiveRef.current) {
                  longPressActiveRef.current = false
                  return
                }
                handleRemoveClick()
              }}
              {...(isUpcoming ? bindRemovePressHandlers() : {})}
            />
          )}
          {isInfoable && (
            <Button
              className={styles.active}
              data-hide
              icon='INFO_OUTLINE'
              onClick={handleInfoClick}
            />
          )}
          {isReplayable && (
            <Button
              className={clsx(styles.active, styles.danger)}
              data-hide
              icon='REPLAY'
              onClick={handleReplayClick}
            />
          )}
          {isSkippable && (
            <Button
              className={clsx(styles.btnPlayNext, styles.danger)}
              data-hide
              icon='PLAY_NEXT'
              onTouchEnd={(e: React.TouchEvent<HTMLButtonElement>) => {
                if (longPressActiveRef.current) {
                  e.preventDefault()
                  e.stopPropagation()
                  longPressActiveRef.current = false
                  return
                }
              }}
              onClick={() => {
                if (longPressActiveRef.current) {
                  longPressActiveRef.current = false
                  return
                }
                handleSkipClick()
              }}
              {...bindSkipPressHandlers()}
            />
          )}
        </Buttons>
        {isPlayed && (
          <>
            {isRequeued && <div className={styles.requeueFeedback} role='status'>Added to queue</div>}
            <Button
              className={clsx(styles.btnRequeue, isRequeued && styles.success)}
              icon={isRequeued ? 'CHECK' : 'PLUS'}
              disabled={isRequeued}
              onClick={handleRequeueClick}
              title={isRequeued ? 'Added to queue' : 'Add back to queue'}
              aria-label={isRequeued ? 'Added to queue' : 'Add back to queue'}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default QueueItem
