import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useLongPress } from 'use-long-press'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import ButtonStar from 'components/ButtonStar/ButtonStar'
import Buttons from 'components/Buttons/Buttons'
import { requestPlayNext, requestReplay } from 'store/modules/status'
import { showSongInfo } from 'store/modules/songInfo'
import { toggleSongStarred } from 'store/modules/userStars'
import { showErrorMessage } from 'store/modules/ui'
import { queueSong, removeItem } from '../../modules/queue'
import type { QueueRowModel } from '../../selectors/getQueueRows'
import styles from './QueueItem.css'

const LONG_PRESS_THRESHOLD_MS = 700

interface QueueItemActionsProps {
  isExpanded: boolean
  isMovable: boolean
  onCollapse(): void
  onPlayNextClick(queueId: number): void
  onRemoveUpcoming(userId: number): void
  row: QueueRowModel
}

const QueueItemActions = ({
  isExpanded,
  isMovable,
  onCollapse,
  onPlayNextClick,
  onRemoveUpcoming,
  row,
}: QueueItemActionsProps) => {
  const {
    errorMessage, isErrored, isOwner, isStarred, queueId, songId, starCount,
    state, userDisplayName, userId,
  } = row
  const isCurrent = state === 'current'
  const isPlayed = state === 'played'
  const isUpcoming = state === 'upcoming'
  const [isRequeued, setRequeued] = useState(false)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressActiveRef = useRef(false)
  const buttonWidth = useAppSelector(state => state.ui.innerWidth <= 600 ? 44 : 56)
  const dispatch = useAppDispatch()

  const collapseAfter = (action: () => void) => {
    action()
    onCollapse()
  }

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
  }, [])

  const bindRemovePressHandlers = useLongPress(() => {
    const text = isOwner ? 'Remove all your upcoming songs?' : `Remove all upcoming songs for "${userDisplayName}"?`
    longPressActiveRef.current = true
    if (confirm(text)) onRemoveUpcoming(userId)
  }, { threshold: LONG_PRESS_THRESHOLD_MS, cancelOnMovement: true })

  const bindSkipPressHandlers = useLongPress(() => {
    const text = isOwner ? 'Skip and remove all your upcoming songs?' : `Skip and remove all upcoming songs for "${userDisplayName}"?`
    longPressActiveRef.current = true
    if (confirm(text)) {
      onRemoveUpcoming(userId)
      collapseAfter(() => dispatch(requestPlayNext()))
    }
  }, { threshold: LONG_PRESS_THRESHOLD_MS, cancelOnMovement: true })

  const suppressLongPressClick = (event?: React.TouchEvent<HTMLButtonElement>) => {
    if (!longPressActiveRef.current) return false
    event?.preventDefault()
    event?.stopPropagation()
    longPressActiveRef.current = false
    return true
  }

  const handleRequeue = () => {
    if (isRequeued) return
    setRequeued(true)
    collapseAfter(() => dispatch(queueSong(songId)))
    feedbackTimerRef.current = setTimeout(() => setRequeued(false), 2000)
  }

  return (
    <>
      <Buttons btnWidth={buttonWidth} isExpanded={isExpanded} className={styles.btnContainer}>
        {isErrored && (
          <Button className={styles.danger} icon='INFO_OUTLINE' onClick={() => dispatch(showErrorMessage(errorMessage))} />
        )}
        {isMovable && (
          <Button
            className={styles.btnPriority}
            icon='PLAY_NEXT'
            onClick={() => onPlayNextClick(queueId)}
            title='Move to top and play next'
            aria-label='Move to top and play next'
          />
        )}
        <ButtonStar
          className={styles.btnStar}
          isStarred={isStarred}
          onClick={() => dispatch(toggleSongStarred(songId))}
          count={starCount}
        />
        {!isCurrent && (
          <Button
            className={clsx(styles.btnRemove, styles.danger)}
            icon='DELETE'
            title='Delete from queue'
            aria-label='Delete from queue'
            onTouchEnd={(event) => { suppressLongPressClick(event) }}
            onClick={() => {
              if (!suppressLongPressClick()) dispatch(removeItem({ queueId }))
            }}
            {...(isUpcoming ? bindRemovePressHandlers() : {})}
          />
        )}
        <Button className={styles.active} data-hide icon='INFO_OUTLINE' onClick={() => dispatch(showSongInfo(songId))} />
        {isCurrent && (
          <Button
            className={clsx(styles.active, styles.danger)}
            data-hide
            icon='REPLAY'
            onClick={() => collapseAfter(() => dispatch(requestReplay(queueId)))}
          />
        )}
        {isCurrent && (
          <Button
            className={clsx(styles.btnPlayNext, styles.danger)}
            data-hide
            icon='PLAY_NEXT'
            onTouchEnd={(event) => { suppressLongPressClick(event) }}
            onClick={() => {
              if (!suppressLongPressClick()) collapseAfter(() => dispatch(requestPlayNext()))
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
            onClick={handleRequeue}
            title={isRequeued ? 'Added to queue' : 'Add back to queue'}
            aria-label={isRequeued ? 'Added to queue' : 'Add back to queue'}
          />
        </>
      )}
    </>
  )
}

export default QueueItemActions
