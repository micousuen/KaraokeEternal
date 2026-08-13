import { describe, expect, it } from 'vitest'
import { MediaProcessingQueue } from './MediaProcessingQueue.js'

describe('MediaProcessingQueue', () => {
  it('deduplicates jobs until completion', () => {
    const queue = new MediaProcessingQueue<{ mediaId: number }>()
    expect(queue.enqueue({ mediaId: 1 })).toBe(true)
    expect(queue.enqueue({ mediaId: 1 })).toBe(false)
    queue.dequeue()
    expect(queue.enqueue({ mediaId: 1 })).toBe(false)
    queue.complete(1)
    expect(queue.enqueue({ mediaId: 1 })).toBe(true)
  })

  it('keeps priority jobs ahead of normal jobs in insertion order', () => {
    const queue = new MediaProcessingQueue<{ mediaId: number, prioritized?: boolean }>()
    queue.enqueue({ mediaId: 1 })
    queue.enqueue({ mediaId: 2 }, true)
    queue.enqueue({ mediaId: 3 }, true)
    expect(queue.list().map(job => job.mediaId)).toEqual([2, 3, 1])
  })
})
