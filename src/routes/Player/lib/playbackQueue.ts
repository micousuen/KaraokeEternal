import type { QueueItem } from 'shared/types'
import type { PlayerState } from '../modules/player'

export interface ActiveQueue {
  result: number[]
  entities: Record<number, QueueItem>
}

export interface PlaybackSelection {
  current?: QueueItem
  next?: QueueItem
  priority?: QueueItem
}

export function selectPlaybackItems (queue: ActiveQueue, player: PlayerState): PlaybackSelection {
  const current = queue.result.includes(player.queueId) ? queue.entities[player.queueId] : undefined
  const regularNext = queue.entities[queue.result[queue.result.indexOf(player.queueId) + 1]]
  const priority = queue.entities[player._priorityQueueId]
  const next = priority && priority.queueId !== player.queueId ? priority : regularNext
  return { current, next, priority }
}

export function replayStatus (player: PlayerState, item: QueueItem): Partial<PlayerState> {
  const history = [...player.history]
  if (item.queueId !== player.queueId) {
    const index = history.lastIndexOf(item.queueId)
    if (index !== -1) history.splice(index)
  }

  return {
    audioTrackCount: 0,
    duration: 0,
    history,
    isAtQueueEnd: false,
    isPlaying: true,
    isVideoKeyingEnabled: item.isVideoKeyingEnabled,
    position: 0,
    queueId: item.queueId,
    nextUserId: null,
    _isReplayingQueueId: null,
  }
}

export function advanceStatus (
  player: PlayerState,
  current?: QueueItem,
  next?: QueueItem,
): Partial<PlayerState> {
  const history = [...player.history]
  if (current && !history.includes(current.queueId)) history.push(current.queueId)

  if (!next) return { history, isAtQueueEnd: true, _isPlayingNext: false }

  return {
    audioTrackCount: 0,
    duration: 0,
    history,
    isAtQueueEnd: false,
    isPlaying: true,
    isVideoKeyingEnabled: next.isVideoKeyingEnabled,
    position: 0,
    queueId: next.queueId,
    nextUserId: null,
    _isPlayingNext: false,
    _priorityQueueId: null,
  }
}

export function findNextUserId (queue: ActiveQueue, current?: QueueItem): number | null {
  const start = queue.result.indexOf(current?.queueId) + 1
  for (let index = start; index < queue.result.length; index++) {
    const item = queue.entities[queue.result[index]]
    if (current?.userId !== item.userId) return item.userId
  }
  return null
}

export function shouldAdvancePlayback (player: PlayerState, queue: ActiveQueue): boolean {
  return player._isPlayingNext
    || (player.isPlaying && !player.isAtQueueEnd && !queue.result.includes(player.queueId))
}

export function getPrecacheMediaIds (
  queue: ActiveQueue,
  current: QueueItem,
  priority?: QueueItem,
): number[] {
  const currentIndex = queue.result.indexOf(current.queueId)
  const upcoming = queue.result.slice(currentIndex + 1).map(queueId => queue.entities[queueId])
  const ordered = priority && priority.queueId !== current.queueId
    ? [priority, ...upcoming.filter(item => item.queueId !== priority.queueId)]
    : upcoming
  return ordered.map(item => item.mediaId)
}
