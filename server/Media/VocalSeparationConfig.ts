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
    alignerModel: string
    language?: string
    vadOnset?: number
    vadOffset?: number
    vadChunkSeconds?: number
    batchSize?: number
    maxLineWidth?: number
    maxLineCount?: number
    minLineWidth?: number
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
    || typeof value.scripting.model !== 'string' || !value.scripting.model
    || typeof value.scripting.alignerModel !== 'string' || !value.scripting.alignerModel) {
    throw new Error(`${configPath}: invalid scripting configuration`)
  }
  const invalidVadOnset = value.scripting.vadOnset !== undefined
    && (!Number.isFinite(value.scripting.vadOnset) || value.scripting.vadOnset <= 0 || value.scripting.vadOnset >= 1)
  const invalidVadOffset = value.scripting.vadOffset !== undefined
    && (!Number.isFinite(value.scripting.vadOffset) || value.scripting.vadOffset <= 0 || value.scripting.vadOffset >= 1)
  const invalidVadChunkSeconds = value.scripting.vadChunkSeconds !== undefined
    && (!Number.isFinite(value.scripting.vadChunkSeconds) || value.scripting.vadChunkSeconds < 5 || value.scripting.vadChunkSeconds > 30)
  const invalidBatchSize = value.scripting.batchSize !== undefined
    && (!Number.isInteger(value.scripting.batchSize) || value.scripting.batchSize < 1 || value.scripting.batchSize > 32)
  const invalidMaxLineWidth = value.scripting.maxLineWidth !== undefined
    && (!Number.isInteger(value.scripting.maxLineWidth) || value.scripting.maxLineWidth < 10)
  const invalidMaxLineCount = value.scripting.maxLineCount !== undefined
    && (!Number.isInteger(value.scripting.maxLineCount) || value.scripting.maxLineCount < 1)
  const invalidMinLineWidth = value.scripting.minLineWidth !== undefined
    && (!Number.isInteger(value.scripting.minLineWidth) || value.scripting.minLineWidth < 1)
  if (invalidVadOnset || invalidVadOffset || invalidVadChunkSeconds || invalidBatchSize || invalidMaxLineWidth
    || invalidMaxLineCount || invalidMinLineWidth) {
    throw new Error(`${configPath}: invalid scripting tuning configuration`)
  }
  return value
}
