import { describe, expect, it } from 'vitest'
import { guardLogin, LoginRateLimitError } from './LoginGuard.js'

describe('login guard', () => {
  it('backs off repeated failed attempts', async () => {
    const key = `failed-${Date.now()}`
    for (let attempt = 0; attempt < 5; attempt++) {
      const fail = async () => {
        throw new Error('bad password')
      }
      await expect(guardLogin(key, fail)).rejects.toThrow('bad password')
    }
    await expect(guardLogin(key, async () => true)).rejects.toBeInstanceOf(LoginRateLimitError)
  })

  it('bounds concurrent password operations', async () => {
    const releases: Array<() => void> = []
    const active = Array.from({ length: 4 }, (_, index) => guardLogin(`active-${Date.now()}-${index}`, () => (
      new Promise<boolean>(resolve => releases.push(() => resolve(true)))
    )))
    await Promise.resolve()

    await expect(guardLogin(`overflow-${Date.now()}`, async () => true)).rejects.toBeInstanceOf(LoginRateLimitError)
    releases.forEach(release => release())
    await Promise.all(active)
  })
})
