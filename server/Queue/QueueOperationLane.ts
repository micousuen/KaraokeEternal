const roomTails = new Map<number, Promise<void>>()

/**
 * Linearize queue reads and writes per room while allowing unrelated rooms to
 * proceed concurrently. A rejected operation cannot block the next request.
 */
export function runQueueOperation<T> (roomId: number, operation: () => T | Promise<T>): Promise<T> {
  const previous = roomTails.get(roomId) || Promise.resolve()
  const result = previous.then(operation, operation)
  const tail = result.then(() => undefined, () => undefined)
  roomTails.set(roomId, tail)
  void tail.then((): void => {
    if (roomTails.get(roomId) === tail) roomTails.delete(roomId)
    return undefined
  })
  return result
}
