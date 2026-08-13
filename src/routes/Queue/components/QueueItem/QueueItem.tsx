import React, { useState } from 'react'
import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import clsx from 'clsx'
import { useSwipeable } from 'react-swipeable'
import Icon from 'components/Icon/Icon'
import type { QueueRowModel } from '../../selectors/getQueueRows'
import OverflowMarquee from './OverflowMarquee'
import QueueItemActions from './QueueItemActions'
import QueueRow from '../QueueRow/QueueRow'
import styles from './QueueItem.css'

interface QueueItemProps {
  dragHandleProps?: DraggableProvidedDragHandleProps | null
  isDragging: boolean
  isMovable: boolean
  row: QueueRowModel
  onPlayNextClick(queueId: number): void
  onRemoveUpcoming(userId: number): void
}

const QueueItem = ({
  dragHandleProps,
  isDragging,
  isMovable,
  onPlayNextClick,
  onRemoveUpcoming,
  row,
}: QueueItemProps) => {
  const [isExpanded, setExpanded] = useState(false)
  const isCurrent = row.state === 'current'
  const isPlayed = row.state === 'played'
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => setExpanded(true),
    onSwipedRight: () => setExpanded(false),
    preventScrollOnSwipe: true,
    trackMouse: true,
  })

  return (
    <QueueRow
      {...swipeHandlers}
      className={clsx(
        styles.queueItem,
        isCurrent && styles.current,
        isCurrent && !row.isPlaying && styles.paused,
        isDragging && styles.dragging,
      )}
      style={{ '--progress': (isCurrent && row.pctPlayed < 2 ? 2 : row.pctPlayed) + '%' } as React.CSSProperties}
      userId={row.userId}
      userDateUpdated={row.userDateUpdated}
      imageClassName={isPlayed ? styles.greyed : undefined}
      leading={isMovable && (
        <div {...dragHandleProps} className={styles.dragHandle} aria-label='Reorder queue item'>
          <Icon icon='DRAG_INDICATOR' />
        </div>
      )}
    >
      <div className={clsx(styles.primary, isPlayed && styles.greyed)} translate='no'>
        <div className={styles.innerPrimary}>
          <OverflowMarquee className={styles.title} text={row.title} />
          <OverflowMarquee className={styles.artist} text={row.artist} />
        </div>
        <div className={clsx(styles.user, row.isOwner && styles.isOwner)}>
          {row.userDisplayName}
        </div>
      </div>

      <QueueItemActions
        isExpanded={isExpanded}
        isMovable={isMovable}
        onCollapse={() => setExpanded(false)}
        onPlayNextClick={onPlayNextClick}
        onRemoveUpcoming={onRemoveUpcoming}
        row={row}
      />
    </QueueRow>
  )
}

export default QueueItem
