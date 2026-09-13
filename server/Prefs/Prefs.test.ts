import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import Prefs from './Prefs.js'

describe('private preferences', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-prefs-'))
    open({ file: path.join(tempDir, 'database.sqlite3'), ro: false })
  })

  afterEach(() => {
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('stores the ElevenLabs API key without exposing it in public preferences', () => {
    expect(Prefs.setElevenLabsApiKey('  sk_test_secret  ')).toBe(true)
    expect(Prefs.getElevenLabsApiKey()).toBe('sk_test_secret')
    expect(Prefs.get()).toMatchObject({ isElevenLabsApiKeyConfigured: true })
    expect(JSON.stringify(Prefs.get())).not.toContain('sk_test_secret')
    expect(db.get<{ data: string }>('SELECT data FROM prefs WHERE key = ?', ['elevenLabsApiKey']))
      .toEqual({ data: '"sk_test_secret"' })
  })

  it('clears the stored key when given a blank value', () => {
    Prefs.setElevenLabsApiKey('sk_test_secret')
    Prefs.setElevenLabsApiKey(' ')
    expect(Prefs.getElevenLabsApiKey()).toBeUndefined()
    expect(Prefs.get()).toMatchObject({ isElevenLabsApiKeyConfigured: false })
  })

  it('rejects private keys through the generic preference setter', () => {
    expect(() => Prefs.set('elevenLabsApiKey', 'secret')).toThrow('dedicated setter')
    expect(() => Prefs.set('jwtKey', 'secret')).toThrow('dedicated setter')
  })
})
