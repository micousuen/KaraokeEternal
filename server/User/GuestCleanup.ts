import getLogger from '../lib/Log.js'
import { publishAllQueues } from '../Queue/QueuePublisher.js'
import { userSockets } from '../lib/socketRooms.js'
import User from './User.js'

const log = getLogger('GuestCleanup')
const retentionDays = positiveNumber(process.env.KES_GUEST_RETENTION_DAYS, 7)
const cleanupIntervalMs = positiveNumber(process.env.KES_GUEST_CLEANUP_INTERVAL_MS, 6 * 60 * 60_000)

export function startGuestCleanup (io): () => void {
  const run = () => removeExpiredGuests(io)
  run()
  const timer = setInterval(run, cleanupIntervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

export function removeExpiredGuests (io, now = Date.now()): number[] {
  const cutoff = Math.floor(now / 1000) - Math.floor(retentionDays * 24 * 60 * 60)
  const expired = User.getExpiredGuestIds(cutoff)
  const removed: number[] = []

  for (const userId of expired) {
    try {
      User.remove(userId)
      io.in(userSockets(userId)).disconnectSockets(true)
      removed.push(userId)
    } catch (error) {
      log.warn('Could not remove expired guest userId=%s: %s', userId, error instanceof Error ? error.message : String(error))
    }
  }

  if (removed.length) {
    publishAllQueues(io)
    log.info('Removed %s guest account(s) older than %s days', removed.length, retentionDays)
  }
  return removed
}

function positiveNumber (value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
