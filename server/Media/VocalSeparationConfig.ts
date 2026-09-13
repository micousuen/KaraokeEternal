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
    language?: string
    maxLineWidth?: number
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
  if (!value.scripting || typeof value.scripting.enabled !== 'boolean') {
    throw new Error(`${configPath}: invalid scripting configuration`)
  }
  const invalidLanguage = value.scripting.language !== undefined
    && (typeof value.scripting.language !== 'string' || !/^[a-z]{2,3}$/i.test(value.scripting.language))
  const invalidMaxLineWidth = value.scripting.maxLineWidth !== undefined
    && (!Number.isInteger(value.scripting.maxLineWidth) || value.scripting.maxLineWidth < 10)
  const invalidMinLineWidth = value.scripting.minLineWidth !== undefined
    && (!Number.isInteger(value.scripting.minLineWidth) || value.scripting.minLineWidth < 1)
  if (invalidLanguage || invalidMaxLineWidth || invalidMinLineWidth) {
    throw new Error(`${configPath}: invalid scripting tuning configuration`)
  }
  return value
}
