import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import getLogger from '../lib/Log.js'

const log = getLogger('WhisperXWorker')
const pythonPath = process.env.KES_PATH_PYTHON || 'python'
const workerPath = process.env.KES_PATH_WHISPERX_WORKER || '/opt/processing/whisperx_worker.py'
const modelRoot = path.join(process.env.KES_PATH_DOWNLOADS || '/media/downloads', '.karaoke-eternal-models')
const pixiLibPath = '/opt/processing/.pixi/envs/default/lib'

export interface WhisperXSettings {
  model: string
  beamSize: number
  vadOnset: number
  maxLineWidth: number
  maxLineCount: number
  minLineWidth: number
  language?: string
  initialPrompt?: string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  onProgress?: (progress: number) => void
  onStage?: (stage: string) => void
}

class WhisperXWorker {
  #child: childProcess.ChildProcessWithoutNullStreams | undefined
  #pending = new Map<number, PendingRequest>()
  #nextId = 0
  #mounted = false
  #loading = false
  #mountPromise: Promise<void> | undefined
  #stderr = ''

  get mounted (): boolean { return this.#mounted }
  get loading (): boolean { return this.#loading }

  async mount (settings: WhisperXSettings): Promise<void> {
    if (this.#mounted) return
    if (this.#mountPromise) return this.#mountPromise
    this.#loading = true
    this.#start()
    this.#mountPromise = (async () => {
      await this.#request({ command: 'mount', settings })
      this.#mounted = true
      log.info('WhisperX models mounted')
    })()
    try {
      await this.#mountPromise
    } finally {
      this.#loading = false
      this.#mountPromise = undefined
    }
  }

  async transcribe (
    audio: string,
    outputDir: string,
    settings: WhisperXSettings,
    onProgress: (progress: number) => void,
    onStage: (stage: string) => void,
  ): Promise<{ language: string, srt: string }> {
    await this.mount(settings)
    return this.#request<{ language: string, srt: string }>({ command: 'transcribe', audio, outputDir, settings }, onProgress, onStage)
  }

  async unmount (): Promise<void> {
    if (!this.#child || this.#pending.size) throw new Error('WhisperX is busy processing a script')
    const child = this.#child
    await this.#request({ command: 'unmount' })
    this.#mounted = false
    child.kill()
    if (this.#child === child) this.#child = undefined
    log.info('WhisperX models unmounted')
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
      log.info('[WhisperX] %s', output.trim())
    })
    child.on('error', err => this.#failAll(err))
    child.on('close', (code, signal) => {
      if (this.#child !== child) return
      this.#child = undefined
      this.#mounted = false
      this.#loading = false
      const reason = code === null ? `signal ${signal || 'unknown'}` : `code ${code}`
      this.#failAll(new Error(`WhisperX worker exited with ${reason}${this.#stderr ? `\n${this.#stderr}` : ''}`))
    })
  }

  #request<T = void> (
    message: Record<string, unknown>,
    onProgress?: (progress: number) => void,
    onStage?: (stage: string) => void,
  ): Promise<T> {
    if (!this.#child?.stdin.writable) return Promise.reject(new Error('WhisperX worker is unavailable'))
    const id = ++this.#nextId
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: value => resolve(value as T), reject, onProgress, onStage })
      this.#child!.stdin.write(`${JSON.stringify({ ...message, id })}\n`)
    })
  }

  #handle (line: string): void {
    let message: { id?: number, event?: string, progress?: number, stage?: string, error?: string, traceback?: string }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      log.info('[WhisperX] %s', line)
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
    if (message.event === 'error') {
      pending.reject(new Error([message.error, message.traceback].filter(Boolean).join('\n')))
    } else pending.resolve(message)
  }

  #failAll (error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}

export default new WhisperXWorker()
