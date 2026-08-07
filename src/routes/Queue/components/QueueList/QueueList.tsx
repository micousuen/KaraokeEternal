import React, { useState } from 'react'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { ensureState } from 'redux-optimistic-ui'
import QueueItem from '../QueueItem/QueueItem'
import Button from 'components/Button/Button'
import { formatSeconds } from 'lib/dateTime'
import { moveItem, removeUpcomingItems, shuffleItems } from '../../modules/queue'
import { requestPriority } from 'store/modules/status'
import getPlayerHistory from '../../selectors/getPlayerHistory'
import getRoundRobinQueue from '../../selectors/getRoundRobinQueue'
import getWaits from '../../selectors/getWaits'
import styles from './QueueList.css'
import fairShuffle from '../../lib/fairShuffle'

const QueueList = () => {
  const [showPlayed, setShowPlayed] = useState(false)
  const artists = useAppSelector(state => state.artists)
  const { errorMessage, isAtQueueEnd, isErrored, isPlaying, position, queueId } = useAppSelector(state => state.status)

  const playerHistory = useAppSelector(getPlayerHistory)
  const queue = useAppSelector(getRoundRobinQueue)
  const songs = useAppSelector(state => state.songs)
  const starredSongs = useAppSelector(state => ensureState(state.userStars).starredSongs)
  const starCounts = useAppSelector(state => state.starCounts)
  const user = useAppSelector(state => state.user)
  const waits = useAppSelector(getWaits)
  const isPlayed = (id: number) => queue.entities[id].isPlayed || playerHistory.includes(id)
  const activeIds = queue.result.filter(id => !isPlayed(id))
  const playedIds = queue.result.filter(isPlayed).reverse()
  const visibleIds = showPlayed ? playedIds : activeIds

  // actions
  const dispatch = useAppDispatch()
  const handleRemoveUpcoming = (userId: number) => {
    dispatch(removeUpcomingItems(userId))
  }

  const handlePlayNextClick = (qId: number) => {
    dispatch(moveItem({ queueId: qId, prevQueueId: queueId >= 0 ? queueId : -1 }))
    dispatch(requestPriority(qId))
  }

  const handleShuffle = () => {
    const locked = queue.result.filter(id => id === queueId || isPlayed(id))
    const upcoming = queue.result.filter(id => id !== queueId && !isPlayed(id))
    const shuffled = fairShuffle(upcoming, id => queue.entities[id].userId)

    dispatch(shuffleItems({ queueIds: [...locked, ...shuffled] }))
  }

  const handleDragEnd = (dnd: DropResult) => {
    if (!dnd.destination || dnd.source.index === dnd.destination.index) return

    const queueIdToMove = visibleIds[dnd.source.index]
    const isUpcoming = queueIdToMove !== queueId && !isPlayed(queueIdToMove)
    if (!isUpcoming || showPlayed) return

    const reordered = activeIds.slice()
    reordered.splice(dnd.source.index, 1)

    // Played/current entries are locked. Clamp drops to the upcoming section.
    const firstUpcoming = reordered.findIndex(id => id !== queueId && !isPlayed(id))
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
    const item = queue.entities[qId]
    const duration = songs.entities[item.songId].duration
    const isCurrent = (qId === queueId) && !isAtQueueEnd
    const isUpcoming = qId !== queueId && !isPlayed(qId)
    const isOwner = item.userId === user.userId

    const isMovable = isUpcoming && !showPlayed

    return (
      <Draggable draggableId={`queue-${qId}`} index={index} isDragDisabled={!isMovable} key={qId}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            style={provided.draggableProps.style}
          >
            <QueueItem
              {...item}
              artist={artists.entities[songs.entities[item.songId].artistId].name}
              dragHandleProps={provided.dragHandleProps}
              errorMessage={isCurrent && errorMessage ? errorMessage : ''}
              isCurrent={isCurrent}
              isDragging={snapshot.isDragging}
              isErrored={isCurrent && isErrored}
              isInfoable
              isMovable={isMovable}
              isOwner={isOwner}
              isPlayed={isPlayed(qId)}
              isPlaying={isCurrent && isPlaying}
              isRemovable={!isCurrent}
              isReplayable={isCurrent}
              isSkippable={isCurrent}
              isStarred={starredSongs.includes(item.songId)}
              isUpcoming={isUpcoming}
              pctPlayed={isCurrent ? position / duration * 100 : 0}
              starCount={starCounts.songs[item.songId] || 0}
              title={songs.entities[item.songId].title}
              wait={formatSeconds(waits[qId], true)} // fuzzy
              onPlayNextClick={handlePlayNextClick}
              onRemoveUpcoming={handleRemoveUpcoming}
            />
          </div>
        )}
      </Draggable>
    )
  })

  const numUpcoming = activeIds.filter(id => id !== queueId).length

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
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </>
  )
}

export default QueueList
