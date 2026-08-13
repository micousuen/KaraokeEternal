import { invalidateLibrary } from '../Library/LibraryPublisher.js'
import { publishAllQueues } from '../Queue/QueuePublisher.js'

function pushQueuesAndLibrary (io): void {
  // Queue patches go first so they cannot reference a removed library item.
  publishAllQueues(io)
  invalidateLibrary(io)
}

export default pushQueuesAndLibrary
