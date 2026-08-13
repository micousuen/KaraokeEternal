import Library from './Library.js'
import { LIBRARY_INVALIDATE } from '../../shared/actionTypes.js'

export function invalidateLibrary (io): number {
  const version = Library.invalidate()
  io.emit('action', { type: LIBRARY_INVALIDATE, payload: { version } })
  return version
}
