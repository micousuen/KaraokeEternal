import Queue from './Queue.js'
import { QUEUE_PATCH, QUEUE_PUSH } from '../../shared/actionTypes.js'
import type { QueueItem, QueuePatch, QueueSnapshot } from '../../shared/types.js'
import { roomSockets } from '../lib/socketRooms.js'

const snapshots = new Map<number, QueueSnapshot>()

export function getQueueSnapshot (roomId: number): QueueSnapshot {
  const cached = snapshots.get(roomId)
  if (cached) return cached
  const queue = Queue.get(roomId)
  const snapshot = { ...queue, revision: 1 }
  snapshots.set(roomId, snapshot)
  return snapshot
}

export function sendQueueSnapshot (socket, roomId: number): void {
  socket.emit('action', { type: QUEUE_PUSH, payload: getQueueSnapshot(roomId) })
}

export function publishQueue (io, roomId: number): void {
  const previous = snapshots.get(roomId)
  const queue = Queue.get(roomId)
  if (!previous) {
    const snapshot = { ...queue, revision: 1 }
    snapshots.set(roomId, snapshot)
    io.to(roomSockets(roomId)).emit('action', { type: QUEUE_PUSH, payload: snapshot })
    return
  }

  const patch = createQueuePatch(previous, queue)
  if (!patch) return
  snapshots.set(roomId, { ...queue, revision: patch.revision })
  io.to(roomSockets(roomId)).emit('action', { type: QUEUE_PATCH, payload: patch })
}

export function publishAllQueues (io): void {
  for (const room of io.sockets.adapter.rooms.keys()) {
    const match = /^ROOM_ID_(\d+)$/.exec(room)
    if (match) publishQueue(io, Number(match[1]))
  }
}

export function forgetQueue (roomId: number): void {
  snapshots.delete(roomId)
}

export function createQueuePatch (
  previous: QueueSnapshot,
  next: { result: number[], entities: Record<number, QueueItem> },
): QueuePatch | null {
  const changed: Record<number, QueueItem> = {}
  for (const queueId of next.result) {
    const item = next.entities[queueId]
    if (!sameQueueItem(previous.entities[queueId], item)) changed[queueId] = item
  }
  const removed = previous.result.filter(queueId => !next.entities[queueId])
  const orderChanged = previous.result.length !== next.result.length
    || previous.result.some((queueId, index) => queueId !== next.result[index])
  if (!orderChanged && removed.length === 0 && Object.keys(changed).length === 0) return null

  return {
    baseRevision: previous.revision,
    revision: previous.revision + 1,
    result: next.result,
    changed,
    removed,
  }
}

function sameQueueItem (left: QueueItem | undefined, right: QueueItem): boolean {
  if (!left) return false
  return left.queueId === right.queueId
    && left.songId === right.songId
    && left.userId === right.userId
    && left.prevQueueId === right.prevQueueId
    && left.mediaId === right.mediaId
    && left.rgTrackGain === right.rgTrackGain
    && left.rgTrackPeak === right.rgTrackPeak
    && left.userDateUpdated === right.userDateUpdated
    && left.userDisplayName === right.userDisplayName
    && left.isPlayed === right.isPlayed
    && left.isVideoKeyingEnabled === right.isVideoKeyingEnabled
}
