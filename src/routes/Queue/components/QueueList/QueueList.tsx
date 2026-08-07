import React from 'react'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { ensureState } from 'redux-optimistic-ui'
import QueueItem from '../QueueItem/QueueItem'
import { formatSeconds } from 'lib/dateTime'
import { moveItem, removeUpcomingItems } from '../../modules/queue'
import { requestPriority } from 'store/modules/status'
import getPlayerHistory from '../../selectors/getPlayerHistory'
import getRoundRobinQueue from '../../selectors/getRoundRobinQueue'
import getWaits from '../../selectors/getWaits'

const QueueList = () => {
  const artists = useAppSelector(state => state.artists)
  const { errorMessage, isAtQueueEnd, isErrored, isPlaying, position, queueId } = useAppSelector(state => state.status)

  const playerHistory = useAppSelector(getPlayerHistory)
  const queue = useAppSelector(getRoundRobinQueue)
  const songs = useAppSelector(state => state.songs)
  const starredSongs = useAppSelector(state => ensureState(state.userStars).starredSongs)
  const starCounts = useAppSelector(state => state.starCounts)
  const user = useAppSelector(state => state.user)
  const waits = useAppSelector(getWaits)

  // actions
  const dispatch = useAppDispatch()
  const handleMoveClick = (qId: number) => {
    // reference user's last-played item as the new prevQueueId
    const userId = queue.entities[qId].userId
    let lastPlayed = queueId // default in case user has no played items

    for (let i = queue.result.indexOf(queueId); i >= 0; i--) {
      if (queue.entities[queue.result[i]].userId === userId) {
        lastPlayed = queue.result[i]
        break
      }
    }

    dispatch(moveItem({ queueId: qId, prevQueueId: lastPlayed }))
  }

  const handleRemoveUpcoming = (userId: number) => {
    dispatch(removeUpcomingItems(userId))
  }

  const handlePlayNextClick = (qId: number) => {
    dispatch(moveItem({ queueId: qId, prevQueueId: queueId >= 0 ? queueId : -1 }))
    dispatch(requestPriority(qId))
  }

  const handleDragEnd = (dnd: DropResult) => {
    if (!dnd.destination || dnd.source.index === dnd.destination.index) return

    const queueIdToMove = queue.result[dnd.source.index]
    const item = queue.entities[queueIdToMove]
    const isUpcoming = queueIdToMove !== queueId && !playerHistory.includes(queueIdToMove)
    if (!isUpcoming || (!user.isAdmin && item.userId !== user.userId)) return

    const reordered = queue.result.slice()
    reordered.splice(dnd.source.index, 1)

    // Played/current entries are locked. Clamp drops to the upcoming section.
    const firstUpcoming = reordered.findIndex(id => id !== queueId && !playerHistory.includes(id))
    const upcomingStart = firstUpcoming === -1 ? reordered.length : firstUpcoming
    const destination = Math.max(dnd.destination.index, upcomingStart)
    reordered.splice(destination, 0, queueIdToMove)

    dispatch(moveItem({
      queueId: queueIdToMove,
      prevQueueId: destination > 0 ? reordered[destination - 1] : -1,
    }))
  }

  // build children array
  const items = queue.result.map((qId, index) => {
    const item = queue.entities[qId]
    const duration = songs.entities[item.songId].duration
    const isCurrent = (qId === queueId) && !isAtQueueEnd
    const isUpcoming = qId !== queueId && !playerHistory.includes(qId)
    const isOwner = item.userId === user.userId

    const isMovable = isUpcoming && (isOwner || user.isAdmin)

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
              isInfoable={user.isAdmin}
              isMovable={isMovable}
              isOwner={isOwner}
              isPlayed={!isUpcoming && !isCurrent}
              isPlaying={isCurrent && isPlaying}
              isRemovable={isUpcoming && (isOwner || user.isAdmin)}
              isReplayable={(!isUpcoming || isCurrent) && user.isAdmin}
              isSkippable={isCurrent && (isOwner || user.isAdmin)}
              isStarred={starredSongs.includes(item.songId)}
              isUpcoming={isUpcoming}
              pctPlayed={isCurrent ? position / duration * 100 : 0}
              starCount={starCounts.songs[item.songId] || 0}
              title={songs.entities[item.songId].title}
              wait={formatSeconds(waits[qId], true)} // fuzzy
              onMoveClick={handleMoveClick}
              onPlayNextClick={handlePlayNextClick}
              onRemoveUpcoming={handleRemoveUpcoming}
            />
          </div>
        )}
      </Draggable>
    )
  })

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId='queue'>
        {provided => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            {items}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  )
}

export default QueueList
