const maxConcurrent = positiveInteger(process.env.KES_LOGIN_MAX_CONCURRENT, 4)
const maxFailures = positiveInteger(process.env.KES_LOGIN_MAX_FAILURES, 5)
const failureWindowMs = positiveInteger(process.env.KES_LOGIN_FAILURE_WINDOW_MS, 15 * 60_000)
const baseDelayMs = positiveInteger(process.env.KES_LOGIN_BACKOFF_MS, 1_000)

interface AttemptState {
  blockedUntil: number
  failures: number
  lastFailure: number
}

const attempts = new Map<string, AttemptState>()
let concurrent = 0

export class LoginRateLimitError extends Error {
  status = 429

  constructor () {
    super('Too many login attempts. Please wait and try again.')
  }
}

export async function guardLogin<T> (key: string, operation: () => Promise<T>): Promise<T> {
  const now = Date.now()
  pruneAttempts(now)
  const state = attempts.get(key)
  if (state && (now - state.lastFailure > failureWindowMs)) attempts.delete(key)
  else if (state && state.blockedUntil > now) throw new LoginRateLimitError()
  if (concurrent >= maxConcurrent) throw new LoginRateLimitError()

  concurrent++
  try {
    const result = await operation()
    attempts.delete(key)
    return result
  } catch (error) {
    const previous = attempts.get(key)
    const failures = (previous?.failures || 0) + 1
    const delay = failures < maxFailures
      ? 0
      : Math.min(5 * 60_000, baseDelayMs * (2 ** Math.min(failures - maxFailures, 8)))
    attempts.set(key, { failures, lastFailure: Date.now(), blockedUntil: Date.now() + delay })
    throw error
  } finally {
    concurrent--
  }
}

function pruneAttempts (now: number): void {
  if (attempts.size < 10_000) return
  for (const [key, state] of attempts) {
    if (now - state.lastFailure > failureWindowMs) attempts.delete(key)
  }
  while (attempts.size >= 10_000) attempts.delete(attempts.keys().next().value!)
}

export function loginAttemptKey (ip: string, username: unknown): string {
  return `${ip}\0${typeof username === 'string' ? username.trim().toLowerCase() : ''}`
}

function positiveInteger (value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
