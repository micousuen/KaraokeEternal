import type { PlayerState } from './player'

export function withoutUndefinedStatus (status: Partial<PlayerState>): Partial<PlayerState> {
  return Object.fromEntries(Object.entries(status).filter(([, value]) => value !== undefined))
}
