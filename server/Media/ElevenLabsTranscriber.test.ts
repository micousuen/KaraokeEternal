import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcribeWithElevenLabs } from './ElevenLabsTranscriber.js'

afterEach(() => vi.unstubAllGlobals())

describe('transcribeWithElevenLabs', () => {
  it('uploads audio to Scribe v2 and formats its word timestamps', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      language_code: 'en',
      words: [
        { text: 'Hello', start: 1, end: 1.5, type: 'word' },
        { text: ' ', start: 1.5, end: 1.5, type: 'spacing' },
        { text: 'world!', start: 1.5, end: 2, type: 'word' },
      ],
    }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-scribe-'))
    const audio = path.join(tempDir, 'vocals.wav')
    fs.writeFileSync(audio, 'wave data')

    try {
      const result = await transcribeWithElevenLabs(audio, 'secret-key', {
        maxLineWidth: 36,
        minLineWidth: 12,
      })
      expect(result.language).toBe('en')
      expect(result.srt).toContain('00:00:01,000 --> 00:00:01,500 A0 C0-5 P1000-1500\nHello world!')
      expect(result.srt).toContain('00:00:01,500 --> 00:00:02,000 A0 C6-12 P1500-2000\nHello world!')

      const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text')
      expect(request.headers).toEqual({ 'xi-api-key': 'secret-key' })
      const form = request.body as FormData
      expect(form.get('model_id')).toBe('scribe_v2')
      expect(form.get('timestamps_granularity')).toBe('word')
      expect(form.get('tag_audio_events')).toBe('false')
      expect(form.get('file')).toBeInstanceOf(Blob)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('surfaces API failures without including the credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid key', { status: 401 })))
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-scribe-'))
    const audio = path.join(tempDir, 'vocals.wav')
    fs.writeFileSync(audio, 'wave data')
    try {
      await expect(transcribeWithElevenLabs(audio, 'secret-key', { maxLineWidth: 36, minLineWidth: 12 }))
        .rejects.toThrow('ElevenLabs transcription failed (401): invalid key')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
