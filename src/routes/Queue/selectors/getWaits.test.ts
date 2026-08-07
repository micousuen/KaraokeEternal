import { describe, expect, it } from 'vitest'
import { calculateWaits } from './getWaits'

const queue = {
  result: [10, 20, 30],
  entities: {
    10: { songId: 1 },
    20: { songId: 2 },
    30: { songId: 3 },
  },
}

const songs = {
  entities: {
    1: { duration: 200 },
    2: { duration: 180 },
    3: { duration: 240 },
  },
}

describe('calculateWaits', () => {
  it('uses live player duration for the current song', () => {
    expect(calculateWaits(queue, 10, 100, 220, songs)).toEqual({
      10: 0,
      20: 120,
      30: 300,
    })
  })

  it('never produces negative waits when position exceeds duration', () => {
    expect(calculateWaits(queue, 10, 250, 220, songs)).toEqual({
      10: 0,
      20: 0,
      30: 180,
    })
  })

  it('counts from the first entry when no song is currently playing', () => {
    expect(calculateWaits(queue, -1, 0, 0, songs)).toEqual({
      10: 0,
      20: 200,
      30: 380,
    })
  })
})
