import React, { useState } from 'react'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import QueueItem from '../QueueItem/QueueItem'
import YouTubeQueueItem from '../YouTubeQueueItem/YouTubeQueueItem'
import Button from 'components/Button/Button'
import { moveItem, playNext, removeUpcomingItems, shuffleItems } from '../../modules/queue'
import getQueueRows from '../../selectors/getQueueRows'
import styles from './QueueList.css'
import fairShuffle from '../../lib/fairShuffle'

const QueueList = () => {
  const [showPlayed, setShowPlayed] = useState(false)
  const { activeIds, currentQueueId, playedIds, queue, rows } = useAppSelector(getQueueRows)
  const youtubeJobs = useAppSelector(state => state.youtubeJobs)
  const visibleIds = showPlayed ? playedIds : activeIds

  // actions
  const dispatch = useAppDispatch()
  const handleRemoveUpcoming = (userId: number) => {
    dispatch(removeUpcomingItems(userId))
  }

  const handlePlayNextClick = (qId: number) => {
    dispatch(playNext({ queueId: qId, prevQueueId: currentQueueId >= 0 ? currentQueueId : -1 }))
  }

  const handleShuffle = () => {
    const locked = queue.result.filter(id => id === currentQueueId || rows[id].state === 'played')
    const upcoming = queue.result.filter(id => id !== currentQueueId && rows[id].state !== 'played')
    const shuffled = fairShuffle(upcoming, id => queue.entities[id].userId)

    dispatch(shuffleItems({ queueIds: [...locked, ...shuffled] }))
  }

  const handleDragEnd = (dnd: DropResult) => {
    if (!dnd.destination || dnd.source.index === dnd.destination.index) return

    const queueIdToMove = visibleIds[dnd.source.index]
    const isUpcoming = rows[queueIdToMove].state === 'upcoming'
    if (!isUpcoming || showPlayed) return

    const reordered = activeIds.slice()
    reordered.splice(dnd.source.index, 1)

    // Played/current entries are locked. Clamp drops to the upcoming section.
    const firstUpcoming = reordered.findIndex(id => rows[id].state === 'upcoming')
    const upcomingStart = firstUpcoming === -1 ? reordered.length : firstUpcoming
    const destination = Math.max(dnd.destination.index, upcomingStart)
    reordered.splice(destination, 0, queueIdToMove)

    dispatch(moveItem({
      queueId: queueIdToMove,
      prevQueueId: destination > 0 ? reordered[destination - 1] : -1,
    }))
  }

  // build children array
  const items = visibleIds.map((qId, index) => {
    const row = rows[qId]
    const isMovable = row.state === 'upcoming' && !showPlayed

    return (
      <Draggable draggableId={`queue-${qId}`} index={index} isDragDisabled={!isMovable} key={qId}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            style={provided.draggableProps.style}
          >
            <QueueItem
              row={row}
              dragHandleProps={provided.dragHandleProps}
              isDragging={snapshot.isDragging}
              isMovable={isMovable}
              onPlayNextClick={handlePlayNextClick}
              onRemoveUpcoming={handleRemoveUpcoming}
            />
          </div>
        )}
      </Draggable>
    )
  })

  const numUpcoming = activeIds.filter(id => id !== currentQueueId).length

  return (
    <>
      <div className={styles.toolbar}>
        <Button onClick={() => setShowPlayed(value => !value)} variant='default'>
          {showPlayed ? 'Back to Queue' : `Played (${playedIds.length})`}
        </Button>
        {!showPlayed && numUpcoming > 1 && (
          <Button onClick={handleShuffle} variant='default'>Shuffle Queue</Button>
        )}
      </div>
      {visibleIds.length === 0 && (showPlayed || playedIds.length > 0) && (
        <div className={styles.empty}>{showPlayed ? 'No played songs' : 'Queue Empty'}</div>
      )}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId={showPlayed ? 'played' : 'queue'}>
          {provided => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {items}
              {!showPlayed && youtubeJobs.result.map(jobId => (
                <YouTubeQueueItem key={jobId} job={youtubeJobs.entities[jobId]} />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </>
  )
}

export default QueueList
