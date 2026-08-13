import { describe, expect, it } from 'vitest'
import { runQueueOperation } from './QueueOperationLane.js'

describe('queue operation lane', () => {
  it('preserves arrival order within a room', async () => {
    const events: string[] = []
    let releaseFirst: () => void = () => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = runQueueOperation(901, async () => {
      events.push('A:start')
      await firstGate
      events.push('A:end')
    })
    const second = runQueueOperation(901, () => {
      events.push('B')
    })

    await Promise.resolve()
    expect(events).toEqual(['A:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['A:start', 'A:end', 'B'])
  })

  it('does not block other rooms or successors after an error', async () => {
    const events: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const blocked = runQueueOperation(902, () => gate)
    await runQueueOperation(903, () => {
      events.push('other room')
    })
    const failed = runQueueOperation(904, () => {
      throw new Error('conflict')
    })
    const recovered = runQueueOperation(904, () => {
      events.push('recovered')
    })

    await expect(failed).rejects.toThrow('conflict')
    await recovered
    expect(events).toEqual(['other room', 'recovered'])
    release()
    await blocked
  })
})
