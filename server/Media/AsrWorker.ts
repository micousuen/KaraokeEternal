import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import getLogger from '../lib/Log.js'
import type { ScriptTimings } from './VocalSeparationHistory.js'

const log = getLogger('AsrWorker')
const pythonPath = process.env.KES_PATH_PYTHON || 'python'
const workerPath = process.env.KES_PATH_ASR_WORKER || '/opt/processing/qwen_worker.py'
const modelRoot = path.join(process.env.KES_PATH_DOWNLOADS || '/media/downloads', '.karaoke-eternal-models')
const pixiLibPath = '/opt/processing/.pixi/envs/default/lib'
const defaultRequestTimeoutMs = 10 * 60 * 1000
const configuredRequestTimeoutMs = Number(process.env.KES_ASR_TIMEOUT_MS)
const requestTimeoutMs = Number.isFinite(configuredRequestTimeoutMs) && configuredRequestTimeoutMs > 0
  ? configuredRequestTimeoutMs
  : defaultRequestTimeoutMs

export interface AsrSettings {
  model: string
  alignerModel: string
  batchSize: number
  vadOnset: number
  vadOffset: number
  vadChunkSeconds: number
  maxLineWidth: number
  maxLineCount: number
  minLineWidth: number
  language?: string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
  onProgress?: (progress: number) => void
  onStage?: (stage: string) => void
}

class AsrWorker {
  #child: childProcess.ChildProcessWithoutNullStreams | undefined
  #pending = new Map<number, PendingRequest>()
  #nextId = 0
  #mounted = false
  #mountPromise: Promise<void> | undefined
  #stderr = ''

  async mount (settings: AsrSettings): Promise<void> {
    if (this.#mounted) return
    if (this.#mountPromise) return this.#mountPromise
    this.#start()
    this.#mountPromise = (async () => {
      await this.#request({ command: 'mount', settings })
      this.#mounted = true
      log.info('Qwen3-ASR models mounted')
    })()
    try {
      await this.#mountPromise
    } finally {
      this.#mountPromise = undefined
    }
  }

  async transcribe (
    audio: string,
    outputDir: string,
    settings: AsrSettings,
    onProgress: (progress: number) => void,
    onStage: (stage: string) => void,
    caption?: { file: string, language: string },
  ): Promise<{ language: string, srt: string, timings?: ScriptTimings }> {
    if (!caption) await this.mount(settings)
    else this.#start()
    return this.#request<{ language: string, srt: string, timings?: ScriptTimings }>({
      command: 'transcribe',
      audio,
      outputDir,
      settings,
      caption: caption?.file,
      captionLanguage: caption?.language,
    }, onProgress, onStage)
  }

  #start (): void {
    if (this.#child) return
    fs.mkdirSync(modelRoot, { recursive: true })
    this.#stderr = ''
    const child = childProcess.spawn(pythonPath, [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: modelRoot,
        HF_HOME: modelRoot,
        TORCH_HOME: modelRoot,
        CUDA_VISIBLE_DEVICES: '',
        PYTHONUNBUFFERED: '1',
        // Pixi's ICU and Python extensions are built against its bundled C++
        // runtime, which is newer than Debian Bookworm's system libstdc++.
        LD_LIBRARY_PATH: [pixiLibPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
      },
    })
    this.#child = child
    readline.createInterface({ input: child.stdout }).on('line', line => this.#handle(line))
    child.stderr.on('data', (chunk) => {
      const output = chunk.toString()
      this.#stderr = (this.#stderr + output).slice(-12_000)
      log.info('[ASR] %s', output.trim())
    })
    child.on('error', err => this.#abort(child, err))
    child.on('close', (code, signal) => {
      if (this.#child !== child) return
      this.#child = undefined
      this.#mounted = false
      const reason = code === null ? `signal ${signal || 'unknown'}` : `code ${code}`
      this.#failAll(new Error(`ASR worker exited with ${reason}${this.#stderr ? `\n${this.#stderr}` : ''}`))
    })
  }

  #request<T = void> (
    message: Record<string, unknown>,
    onProgress?: (progress: number) => void,
    onStage?: (stage: string) => void,
  ): Promise<T> {
    if (!this.#child?.stdin.writable) return Promise.reject(new Error('ASR worker is unavailable'))
    const child = this.#child
    const id = ++this.#nextId
    return new Promise<T>((resolve, reject) => {
      const command = typeof message.command === 'string' ? message.command : 'request'
      const timeout = setTimeout(() => {
        if (!this.#pending.has(id)) return
        // A timed-out inference may leave Python permanently occupied. Kill it
        // so the next request starts a clean worker and mounts models again.
        this.#abort(child, new Error(`ASR ${command} timed out after ${Math.round(requestTimeoutMs / 1000)} seconds`))
      }, requestTimeoutMs)
      timeout.unref()
      this.#pending.set(id, { resolve: value => resolve(value as T), reject, timeout, onProgress, onStage })
      child.stdin.write(`${JSON.stringify({ ...message, id })}\n`, (error) => {
        if (!error) return
        const pending = this.#pending.get(id)
        if (!pending) return
        this.#abort(child, error)
      })
    })
  }

  #handle (line: string): void {
    let message: { id?: number, event?: string, progress?: number, stage?: string, error?: string, traceback?: string }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      log.info('[ASR] %s', line)
      return
    }
    const pending = message.id === undefined ? undefined : this.#pending.get(message.id)
    if (!pending) return
    if (message.event === 'progress' && typeof message.progress === 'number') {
      pending.onProgress?.(message.progress)
      return
    }
    if (message.event === 'stage' && typeof message.stage === 'string') {
      pending.onStage?.(message.stage)
      return
    }
    this.#pending.delete(message.id!)
    clearTimeout(pending.timeout)
    if (message.event === 'error') {
      pending.reject(new Error([message.error, message.traceback].filter(Boolean).join('\n')))
    } else pending.resolve(message)
  }

  #failAll (error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #abort (child: childProcess.ChildProcessWithoutNullStreams, error: Error): void {
    if (this.#child !== child) return
    // Detach first so a subsequent request can spawn its replacement without
    // racing the old process's asynchronous close event.
    this.#child = undefined
    this.#mounted = false
    this.#failAll(error)
    child.kill('SIGKILL')
  }
}

export default new AsrWorker()
