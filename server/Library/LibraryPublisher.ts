import Library from './Library.js'
import { LIBRARY_INVALIDATE } from '../../shared/actionTypes.js'

export function invalidateLibrary (io): number {
  Library.cache.version = null
  const version = Library.get().version!
  io.emit('action', { type: LIBRARY_INVALIDATE, payload: { version } })
  return version
}
