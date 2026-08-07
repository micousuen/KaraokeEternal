/**
 * Randomize songs within each user's selections and interleave users evenly.
 * The user rotation itself is randomized as well.
 */
export default function fairShuffle (
  queueIds: number[],
  getUserId: (queueId: number) => number,
  random: () => number = Math.random,
): number[] {
  const byUser = new Map<number, number[]>()

  for (const queueId of queueIds) {
    const userId = getUserId(queueId)
    const songs = byUser.get(userId) || []
    songs.push(queueId)
    byUser.set(userId, songs)
  }

  const groups = [...byUser.values()]
  shuffle(groups, random)
  for (const songs of groups) shuffle(songs, random)

  const result: number[] = []
  let hasSongs = true

  while (hasSongs) {
    hasSongs = false
    for (const songs of groups) {
      const queueId = songs.shift()
      if (queueId === undefined) continue
      result.push(queueId)
      hasSongs = true
    }
  }

  return result
}

function shuffle<T> (items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
}
