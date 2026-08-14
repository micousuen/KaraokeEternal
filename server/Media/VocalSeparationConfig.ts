import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

export interface SeparationConfig {
  enabled: boolean
  model: string
  segmentSeconds: number
  overlap: number
  shifts: number
  outputBitrate: string
  instrumentalVocalMix: number
  scripting: {
    enabled: boolean
    model: string
    language?: string
    vadOnset?: number
    vadChunkSeconds?: number
    beamSize?: number
    patience?: number
    lengthPenalty?: number
    maxLineWidth?: number
    maxLineCount?: number
    minLineWidth?: number
    initialPrompt?: string
  }
}

export function loadVocalSeparationConfig (
  configPath = process.env.KES_PATH_VOCAL_SEPARATION_CONFIG || path.resolve('config/vocal-separation.yaml'),
): SeparationConfig {
  const value = parse(fs.readFileSync(configPath, 'utf8')) as SeparationConfig
  if (typeof value.enabled !== 'boolean' || typeof value.model !== 'string' || !value.model
    || !Number.isFinite(value.segmentSeconds) || !Number.isFinite(value.overlap)
    || !Number.isInteger(value.shifts) || typeof value.outputBitrate !== 'string'
    || !Number.isFinite(value.instrumentalVocalMix) || value.instrumentalVocalMix < 0 || value.instrumentalVocalMix > 1) {
    throw new Error(`${configPath}: invalid vocal separation configuration`)
  }
  if (!value.scripting || typeof value.scripting.enabled !== 'boolean'
    || typeof value.scripting.model !== 'string' || !value.scripting.model) {
    throw new Error(`${configPath}: invalid scripting configuration`)
  }
  const invalidVadOnset = value.scripting.vadOnset !== undefined
    && (!Number.isFinite(value.scripting.vadOnset) || value.scripting.vadOnset <= 0 || value.scripting.vadOnset >= 1)
  const invalidVadChunkSeconds = value.scripting.vadChunkSeconds !== undefined
    && (!Number.isFinite(value.scripting.vadChunkSeconds) || value.scripting.vadChunkSeconds < 5 || value.scripting.vadChunkSeconds > 30)
  const invalidBeamSize = value.scripting.beamSize !== undefined
    && (!Number.isInteger(value.scripting.beamSize) || value.scripting.beamSize < 1)
  const invalidPatience = value.scripting.patience !== undefined
    && (!Number.isFinite(value.scripting.patience) || value.scripting.patience < 1 || value.scripting.patience > 5)
  const invalidLengthPenalty = value.scripting.lengthPenalty !== undefined
    && (!Number.isFinite(value.scripting.lengthPenalty) || value.scripting.lengthPenalty <= 0 || value.scripting.lengthPenalty > 3)
  const invalidMaxLineWidth = value.scripting.maxLineWidth !== undefined
    && (!Number.isInteger(value.scripting.maxLineWidth) || value.scripting.maxLineWidth < 10)
  const invalidMaxLineCount = value.scripting.maxLineCount !== undefined
    && (!Number.isInteger(value.scripting.maxLineCount) || value.scripting.maxLineCount < 1)
  const invalidMinLineWidth = value.scripting.minLineWidth !== undefined
    && (!Number.isInteger(value.scripting.minLineWidth) || value.scripting.minLineWidth < 1)
  const invalidInitialPrompt = value.scripting.initialPrompt !== undefined
    && typeof value.scripting.initialPrompt !== 'string'
  if (invalidVadOnset || invalidVadChunkSeconds || invalidBeamSize || invalidPatience || invalidLengthPenalty || invalidMaxLineWidth
    || invalidMaxLineCount || invalidMinLineWidth || invalidInitialPrompt) {
    throw new Error(`${configPath}: invalid scripting tuning configuration`)
  }
  return value
}
