import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractSongNameWithDeepSeek } from './DeepSeekSongNamer.js'

afterEach(() => vi.unstubAllGlobals())

describe('extractSongNameWithDeepSeek', () => {
  it('sends the video title to DeepSeek and parses the artist and title', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"artist":"Queen","title":"Bohemian Rhapsody"}' } }],
    }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await extractSongNameWithDeepSeek('Queen  Bohemian Rhapsody Karaoke HD', 'secret-key')
    expect(result).toEqual({ artist: 'Queen', title: 'Bohemian Rhapsody' })

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(request.headers).toEqual({
      'Authorization': 'Bearer secret-key',
      'Content-Type': 'application/json',
    })
    const body = JSON.parse(request.body as string) as {
      model: string
      messages: Array<Record<string, string>>
      response_format: { type: string }
    }
    expect(body.model).toBe('deepseek-chat')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages.at(-1)?.content).toBe('YouTube video title: Queen Bohemian Rhapsody Karaoke HD')
  })

  it('sanitizes filename-hostile characters from the returned names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ artist: '  Queen ', title: 'What\u0007\'s "New"?\r\n In \nYou' }) } }],
    }), { headers: { 'Content-Type': 'application/json' } })))

    const result = await extractSongNameWithDeepSeek('Queen karaoke', 'secret-key')
    expect(result).toEqual({ artist: 'Queen', title: 'What\'s New In You' })
  })

  it('surfaces API failures without including the credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid key', { status: 401 })))

    await expect(extractSongNameWithDeepSeek('Queen karaoke', 'secret-key'))
      .rejects.toThrow('DeepSeek song naming failed (401): invalid key')
  })

  it('rejects responses without usable names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"artist":"Queen"}' } }],
    }), { headers: { 'Content-Type': 'application/json' } })))

    await expect(extractSongNameWithDeepSeek('Queen karaoke', 'secret-key'))
      .rejects.toThrow('DeepSeek returned no title')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'not json' } }],
    }), { headers: { 'Content-Type': 'application/json' } })))

    await expect(extractSongNameWithDeepSeek('Queen karaoke', 'secret-key'))
      .rejects.toThrow('DeepSeek returned an invalid song name response')
  })

  it('rejects empty input without calling DeepSeek', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(extractSongNameWithDeepSeek('   ', 'secret-key')).rejects.toThrow('No video title to analyze')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
