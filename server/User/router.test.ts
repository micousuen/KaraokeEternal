import { describe, expect, it } from 'vitest'
import router from './router.js'

describe('user router composition', () => {
  it('mounts session, account, and admin routes under one API prefix', () => {
    const hasRoute = (method: string, path: string) => router.stack.some(layer => (
      layer.methods.includes(method) && layer.path === path
    ))

    expect(hasRoute('POST', '/api/login')).toBe(true)
    expect(hasRoute('GET', '/api/user')).toBe(true)
    expect(hasRoute('PUT', '/api/user/:userId')).toBe(true)
    expect(hasRoute('GET', '/api/users')).toBe(true)
    expect(router.stack.some(layer => typeof layer.path === 'string' && layer.path.includes('/api/api/'))).toBe(false)
  })
})
