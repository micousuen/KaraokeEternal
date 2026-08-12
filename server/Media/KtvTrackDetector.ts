import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

export interface KtvTrackDetection {
  duration: number
  audioTrackCount: number
  ktvTrack: 0 | 1 | null
  confidence: number
  vocalTrack: 0 | 1 | null
  spectralDifference: number
  complexityDifference: number
  agreement: number
  windowsAnalyzed: number
}

const ffmpegPath = process.env.KES_PATH_FFMPEG || 'ffmpeg'
const ffprobePath = process.env.KES_PATH_FFPROBE || 'ffprobe'
const sampleRate = 8000
const fftSize = 1024
const distributionBins = 48

interface SpectralWindow {
  distribution: number[]
  complexity: number
}

export interface KtvDetectorOptions {
  windowSeconds?: number
  smoothingFrames?: number
  lagFrames?: number
  vocalLowHz?: number
  vocalHighHz?: number
  minimumAgreement?: number
  minimumComplexity?: number
}

const frameCache = new Map<string, Promise<number[][]>>()
const configPath = process.env.KES_PATH_KTV_DETECTOR_CONFIG
  || path.resolve('config/ktv-detector.yaml')
export const ktvDetectorDefaults = loadConfig(configPath)

/** Compare normalized spectral shapes, independently of overall magnitude. */
export async function detectKtvTrack (
  source: string,
  options: number | KtvDetectorOptions = {},
): Promise<KtvTrackDetection> {
  const config = typeof options === 'number' ? { windowSeconds: options } : options
  const windowSeconds = config.windowSeconds ?? ktvDetectorDefaults.windowSeconds
  const smoothingFrames = config.smoothingFrames ?? ktvDetectorDefaults.smoothingFrames
  const lagFrames = config.lagFrames ?? ktvDetectorDefaults.lagFrames
  const vocalLowHz = config.vocalLowHz ?? ktvDetectorDefaults.vocalLowHz
  const vocalHighHz = config.vocalHighHz ?? ktvDetectorDefaults.vocalHighHz
  const minimumAgreement = config.minimumAgreement ?? ktvDetectorDefaults.minimumAgreement
  const minimumComplexity = config.minimumComplexity ?? ktvDetectorDefaults.minimumComplexity
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error('windowSeconds must be greater than zero')
  }
  const { duration, audioTrackCount } = await probe(source)
  if (audioTrackCount !== 2 || duration <= 0) return unknown(0, 0, 0, 0, audioTrackCount, duration)

  const [track0, track1] = await Promise.all([
    readSpectralWindows(source, 0, duration, windowSeconds, smoothingFrames, lagFrames, vocalLowHz, vocalHighHz),
    readSpectralWindows(source, 1, duration, windowSeconds, smoothingFrames, lagFrames, vocalLowHz, vocalHighHz),
  ])
  const signedEvidence: number[] = []
  const divergences: number[] = []

  for (let i = 0; i < Math.min(track0.length, track1.length); i++) {
    const a = track0[i]
    const b = track1[i]
    const divergence = jensenShannon(a.distribution, b.distribution)
    if (divergence < 0.00005) continue

    // Singing changes its harmonics and formants over time. Compare average
    // frame-to-frame movement of the conditional vocal-band distributions.
    // Each frame is normalized separately, so amplitude changes do not count.
    const evidence = a.complexity - b.complexity
    signedEvidence.push(evidence)
    divergences.push(divergence)
  }

  if (!signedEvidence.length) return unknown(0, 0, 0, 0, audioTrackCount, duration)

  const medianEvidence = median(signedEvidence)
  const agreement = signedEvidence.filter(value => Math.sign(value) === Math.sign(medianEvidence)).length / signedEvidence.length
  const medianDivergence = median(divergences)
  const relativeEvidence = Math.abs(medianEvidence)

  if (agreement < minimumAgreement || relativeEvidence < minimumComplexity) {
    return unknown(signedEvidence.length, medianDivergence, medianEvidence, agreement, audioTrackCount, duration)
  }

  const vocalTrack: 0 | 1 = medianEvidence > 0 ? 0 : 1
  return {
    duration,
    ktvTrack: vocalTrack === 0 ? 1 : 0,
    audioTrackCount,
    vocalTrack,
    confidence: Math.min(0.99, relativeEvidence * agreement * 40),
    spectralDifference: medianDivergence,
    complexityDifference: medianEvidence,
    agreement,
    windowsAnalyzed: signedEvidence.length,
  }
}

function loadConfig (filename: string): Required<KtvDetectorOptions> {
  const parsed = parse(fs.readFileSync(filename, 'utf8')) as Record<string, unknown>
  const config = {
    windowSeconds: requireNumber(parsed, 'windowSeconds', value => value > 0),
    smoothingFrames: requireNumber(parsed, 'smoothingFrames', Number.isInteger, value => value >= 1),
    lagFrames: requireNumber(parsed, 'lagFrames', Number.isInteger, value => value >= 1),
    vocalLowHz: requireNumber(parsed, 'vocalLowHz', value => value >= 0),
    vocalHighHz: requireNumber(parsed, 'vocalHighHz', value => value > 0 && value <= sampleRate / 2),
    minimumAgreement: requireNumber(parsed, 'minimumAgreement', value => value >= 0 && value <= 1),
    minimumComplexity: requireNumber(parsed, 'minimumComplexity', value => value >= 0),
  }
  if (config.vocalLowHz >= config.vocalHighHz) {
    throw new Error(`${filename}: vocalLowHz must be less than vocalHighHz`)
  }
  return config
}

function requireNumber (
  config: Record<string, unknown>,
  key: string,
  ...checks: ((value: number) => boolean)[]
): number {
  const value = config[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || checks.some(check => !check(value))) {
    throw new Error(`${configPath}: invalid ${key}`)
  }
  return value
}

async function probe (source: string): Promise<{ duration: number, audioTrackCount: number }> {
  const { stdout } = await execFile(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', source,
  ])
  const result = JSON.parse(stdout.toString()) as {
    format?: { duration?: string }
    streams?: { codec_type?: string }[]
  }
  return {
    duration: Number(result.format?.duration || 0),
    audioTrackCount: result.streams?.filter(stream => stream.codec_type === 'audio').length || 0,
  }
}

async function readSpectralWindows (
  source: string,
  track: number,
  duration: number,
  windowSeconds: number,
  smoothingFrames: number,
  lagFrames: number,
  vocalLowHz: number,
  vocalHighHz: number,
): Promise<SpectralWindow[]> {
  const frameSpectra = await readSpectralFrames(source, track, duration)
  const framesPerWindow = Math.max(1, Math.floor(sampleRate * windowSeconds / fftSize))
  const windows: SpectralWindow[] = []
  const smoothedVocalDistributions: number[][] = []

  for (let frame = 0; frame < frameSpectra.length; frame++) {
    const windowIndex = Math.floor(frame / framesPerWindow)
    const window = windows[windowIndex] || {
      distribution: Array(distributionBins).fill(0),
      complexity: 0,
    }
    for (let bin = 0; bin < distributionBins; bin++) window.distribution[bin] += frameSpectra[frame][bin]

    const smoothingStart = Math.max(0, frame - smoothingFrames + 1)
    const smoothed = Array(distributionBins).fill(0)
    for (let smoothFrame = smoothingStart; smoothFrame <= frame; smoothFrame++) {
      for (let bin = 0; bin < distributionBins; bin++) smoothed[bin] += frameSpectra[smoothFrame][bin]
    }
    const vocalDistribution = normalize(vocalBand(smoothed, vocalLowHz, vocalHighHz))
    smoothedVocalDistributions.push(vocalDistribution)
    const previous = smoothedVocalDistributions[frame - lagFrames]
    if (previous && frame % framesPerWindow >= lagFrames) {
      window.complexity += jensenShannon(vocalDistribution, previous)
    }
    windows[windowIndex] = window
  }

  return windows.map(window => ({
    distribution: normalize(window.distribution),
    complexity: window.complexity / Math.max(1, framesPerWindow - lagFrames),
  }))
}

async function readSpectralFrames (source: string, track: number, duration: number): Promise<number[][]> {
  const key = `${source}\0${track}`
  const cached = frameCache.get(key)
  if (cached) return cached
  const pending = extractSpectralFrames(source, track, duration)
  frameCache.set(key, pending)
  return pending
}

async function extractSpectralFrames (source: string, track: number, duration: number): Promise<number[][]> {
  const { stdout } = await execFile(ffmpegPath, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', source,
    '-map', `0:a:${track}`, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1',
  ], { maxBuffer: Math.ceil(sampleRate * duration * 4 * 1.05) + 1024 })
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4))
  const frames: number[][] = []

  for (let frame = 0; frame * fftSize < samples.length; frame++) {
    const offset = frame * fftSize
    const real = new Float64Array(fftSize)
    const imag = new Float64Array(fftSize)
    for (let i = 0; i < fftSize; i++) {
      const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1))
      real[i] = (samples[offset + i] || 0) * hann
    }
    fft(real, imag)

    const frameSpectrum = Array(distributionBins).fill(0)
    for (let i = 1; i < fftSize / 2; i++) {
      const bin = Math.min(distributionBins - 1, Math.floor(i * 2 * distributionBins / fftSize))
      const power = real[i] * real[i] + imag[i] * imag[i]
      frameSpectrum[bin] += power
    }
    frames.push(frameSpectrum)
  }
  return frames
}

async function execFile (
  command: string,
  args: string[],
  options: { maxBuffer?: number } = {},
): Promise<{ stdout: Buffer, stderr: Buffer }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await execFileOnce(command, args, options.maxBuffer)
    } catch (err) {
      if (attempt === 3 || !isNoChildProcessError(err)) throw err
    }
  }
  throw new Error(`${path.basename(command)} did not start`)
}

function execFileOnce (
  command: string,
  args: string[],
  maxBuffer = Number.POSITIVE_INFINITY,
): Promise<{ stdout: Buffer, stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutSize = 0
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      const output = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
      if (err) reject(Object.assign(err, output))
      else resolve(output)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length
      if (stdoutSize > maxBuffer) {
        child.kill('SIGKILL')
        finish(new Error(`${path.basename(command)} output exceeded ${maxBuffer} bytes`))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', finish)
    child.on('close', (code, signal) => {
      if (code === 0) finish()
      else finish(new Error(`${path.basename(command)} exited with ${code === null ? `signal ${signal || 'unknown'}` : `code ${code}`}`))
    })
  })
}

function isNoChildProcessError (err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return ('code' in err && err.code === 'ECHILD') || /no child processes/i.test(`${err.message}\n${'stderr' in err ? err.stderr : ''}`)
}

function fft (real: Float64Array, imag: Float64Array): void {
  for (let i = 1, j = 0; i < real.length; i++) {
    let bit = real.length >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) [real[i], real[j]] = [real[j], real[i]]
  }
  for (let length = 2; length <= real.length; length <<= 1) {
    const angle = -2 * Math.PI / length
    for (let start = 0; start < real.length; start += length) {
      for (let i = 0; i < length / 2; i++) {
        const cos = Math.cos(angle * i)
        const sin = Math.sin(angle * i)
        const even = start + i
        const odd = even + length / 2
        const oddReal = real[odd] * cos - imag[odd] * sin
        const oddImag = real[odd] * sin + imag[odd] * cos
        real[odd] = real[even] - oddReal
        imag[odd] = imag[even] - oddImag
        real[even] += oddReal
        imag[even] += oddImag
      }
    }
  }
}

function normalize (values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0) || 1
  return values.map(value => value / total)
}

function jensenShannon (a: number[], b: number[]): number {
  let result = 0
  for (let i = 0; i < a.length; i++) {
    const middle = (a[i] + b[i]) / 2
    if (a[i] > 0) result += 0.5 * a[i] * Math.log(a[i] / middle)
    if (b[i] > 0) result += 0.5 * b[i] * Math.log(b[i] / middle)
  }
  return result
}

function vocalBand (distribution: number[], lowHz: number, highHz: number): number[] {
  const vocalBins: number[] = []
  for (let bin = 0; bin < distribution.length; bin++) {
    const frequency = (bin + 0.5) * (sampleRate / 2) / distributionBins
    if (frequency >= lowHz && frequency <= highHz) vocalBins.push(distribution[bin])
  }
  return vocalBins
}

function median (values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function unknown (
  windowsAnalyzed: number,
  spectralDifference = 0,
  complexityDifference = 0,
  agreement = 0,
  audioTrackCount = 2,
  duration = 0,
): KtvTrackDetection {
  return {
    duration,
    audioTrackCount,
    ktvTrack: null,
    confidence: 0,
    vocalTrack: null,
    spectralDifference,
    complexityDifference,
    agreement,
    windowsAnalyzed,
  }
}
