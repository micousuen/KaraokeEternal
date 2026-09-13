const endpoint = 'https://api.deepseek.com/chat/completions'
const defaultModel = 'deepseek-chat'
const defaultTimeoutMs = 30_000

export interface SongName {
  artist: string
  title: string
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

const SYSTEM_PROMPT = [
  'You organize a karaoke library.',
  'Extract the performing artist and the song title from a YouTube video title or filename.',
  'Ignore words that describe the video rather than the song, such as karaoke, instrumental, lyrics, cover, acoustic, live, MV, PV, official video, full, HD, 4K, or "with lyrics".',
  'For covers, use the covering artist when one is named, otherwise the original artist.',
  'Keep names in their original language and script; do not translate or transliterate.',
  'If no artist can be determined, use "Unknown Artist".',
  'If no song title can be determined, use the cleaned-up video title.',
  'Respond with only a json object: {"artist": string, "title": string}',
].join(' ')

export async function extractSongNameWithDeepSeek (
  input: string,
  apiKey: string,
): Promise<SongName> {
  const videoTitle = input.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!videoTitle) throw new Error('No video title to analyze')

  const configuredModel = process.env.KES_DEEPSEEK_MODEL?.trim()
  const model = configuredModel || defaultModel
  const configuredTimeout = Number(process.env.KES_DEEPSEEK_TIMEOUT_MS)
  const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : defaultTimeoutMs

  let response: Response
  try {
    response = await fetch(endpoint, {
      body: JSON.stringify({
        model,
        messages: [
          { content: SYSTEM_PROMPT, role: 'system' },
          { content: `YouTube video title: ${videoTitle}`, role: 'user' },
        ],
        response_format: { type: 'json_object' },
      }),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error(`DeepSeek song naming timed out after ${Math.round(timeoutMs / 1000)} seconds`)
    }
    throw new Error(`Could not reach DeepSeek: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 2_000)
    throw new Error(`DeepSeek song naming failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }

  let completion: ChatCompletionResponse
  try {
    completion = await response.json() as ChatCompletionResponse
  } catch {
    throw new Error('DeepSeek returned an invalid response')
  }

  const content = completion.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('DeepSeek returned no song name')

  let parsed: { artist?: unknown, title?: unknown }
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('DeepSeek returned an invalid song name response')
  }

  return {
    artist: sanitizeSongNameField(parsed.artist, 'artist'),
    title: sanitizeSongNameField(parsed.title, 'title'),
  }
}

function sanitizeSongNameField (value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`DeepSeek returned no ${field}`)
  const cleaned = [...value.replace(/[<>:"/\\|?*]/g, '')]
    .filter(char => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || cleaned.length > 150) throw new Error(`DeepSeek returned an invalid ${field}`)
  return cleaned
}
