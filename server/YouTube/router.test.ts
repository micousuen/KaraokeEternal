import { describe, expect, it } from 'vitest'
import router from './router.js'

describe('YouTube router', () => {
  it('exposes a cancel endpoint for room download jobs', () => {
    expect(router.stack.some(layer => (
      layer.methods.includes('DELETE') && layer.path === '/api/youtube/:jobId'
    ))).toBe(true)
  })
})
