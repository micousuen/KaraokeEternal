import { describe, expect, it } from 'vitest'
import fairShuffle from './fairShuffle'

const users: Record<number, number> = {
  1: 1, 2: 1, 3: 1,
  4: 2, 5: 2, 6: 2,
  7: 3,
}

describe('fairShuffle', () => {
  it('interleaves one song per user in rounds', () => {
    expect(fairShuffle([1, 2, 3, 4, 5, 6, 7], id => users[id], () => 0.999))
      .toEqual([1, 4, 7, 2, 5, 3, 6])
  })

  it('can randomize the starting user and each user song order', () => {
    const result = fairShuffle([1, 2, 3, 4, 5, 6, 7], id => users[id], () => 0)

    expect(result.slice(0, 3).map(id => users[id])).toEqual([2, 3, 1])
    expect(result).toEqual([5, 7, 2, 6, 3, 4, 1])
  })

  it('returns every queue item exactly once', () => {
    const result = fairShuffle([1, 2, 3, 4, 5, 6, 7], id => users[id])
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
