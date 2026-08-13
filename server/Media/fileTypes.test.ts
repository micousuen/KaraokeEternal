import { describe, expect, it } from 'vitest'
import fileTypes from './fileTypes.js'

describe('library media types', () => {
  it('scans video files only', () => {
    const scanned = Object.entries(fileTypes)
      .filter(([, type]) => !('scan' in type) || type.scan !== false)
      .map(([extension]) => extension)

    expect(scanned).toEqual(['.mkv', '.mp4'])
  })
})
