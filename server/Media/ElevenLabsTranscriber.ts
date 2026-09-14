import fsPromises from 'node:fs/promises'
import path from 'node:path'
import type { ScriptTimings } from './VocalSeparationHistory.js'
import { createRollingSrt, type TranscriptWord } from '../../shared/subtitleFormat.js'

const endpoint = 'https://api.elevenlabs.io/v1/speech-to-text'
const defaultTimeoutMs = 10 * 60_000

export interface ElevenLabsSettings {
  language?: string
  maxLineWidth: number
  minLineWidth: number
}

interface ScribeResponse {
  language_code?: string
  words?: TranscriptWord[]
}

export async function transcribeWithElevenLabs (
  audio: string,
  apiKey: string,
  settings: ElevenLabsSettings,
  signal?: AbortSignal,
): Promise<{ language: string, srt: string, timings: ScriptTimings }> {
  const startedAt = performance.now()
  const audioData = await fsPromises.readFile(audio)
  const form = new FormData()
  form.append('file', new Blob([audioData], { type: 'audio/wav' }), path.basename(audio))
  form.append('model_id', 'scribe_v2')
  form.append('tag_audio_events', 'false')
  form.append('diarize', 'false')
  form.append('timestamps_granularity', 'word')
  if (settings.language) form.append('language_code', settings.language)

  const configuredTimeout = Number(process.env.KES_ELEVENLABS_TIMEOUT_MS)
  const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : defaultTimeoutMs
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetch(endpoint, {
      body: form,
      headers: { 'xi-api-key': apiKey },
      method: 'POST',
      signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal,
    })
  } catch (error) {
    if (signal?.aborted) throw new Error('ElevenLabs transcription was canceled')
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error(`ElevenLabs transcription timed out after ${Math.round(timeoutMs / 1000)} seconds`)
    }
    throw new Error(`Could not reach ElevenLabs: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 2_000)
    throw new Error(`ElevenLabs transcription failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }

  let result: ScribeResponse
  try {
    result = await response.json() as ScribeResponse
  } catch {
    throw new Error('ElevenLabs returned an invalid transcription response')
  }
  const language = result.language_code?.trim() || settings.language || 'und'
  if (!Array.isArray(result.words)) throw new Error('ElevenLabs returned no word timestamps')
  const srt = createRollingSrt(result.words, language, settings.maxLineWidth, settings.minLineWidth)
  if (!srt) throw new Error('ElevenLabs returned no transcribed lyrics')

  return {
    language,
    srt,
    timings: {
      align: null,
      transcribe: (performance.now() - startedAt) / 1000,
      vad: null,
    },
  }
}
