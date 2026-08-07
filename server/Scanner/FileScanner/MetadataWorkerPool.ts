import { Worker } from 'node:worker_threads'

export interface MetadataTask {
  file: string
  parserConfig?: Record<string, unknown>
}

export interface MetadataResult {
  duration: number
  parsed: {
    artist: string
    artistNorm: string
    title: string
    titleNorm: string
  }
  rgTrackGain: number | null
  rgTrackPeak: number | null
}

interface PendingTask {
  id: number
  input: MetadataTask
  resolve: (result: MetadataResult) => void
  reject: (err: Error) => void
}

interface WorkerSlot {
  worker: Worker
  task?: PendingTask
}

class MetadataWorkerPool {
  #idle: WorkerSlot[] = []
  #queue: PendingTask[] = []
  #slots = new Set<WorkerSlot>()
  #nextId = 1
  #isClosing = false
  readonly size: number

  constructor (size: number, filenameFormat: string) {
    this.size = size
    for (let i = 0; i < size; i++) this.#spawn(filenameFormat)
  }

  run (input: MetadataTask): Promise<MetadataResult> {
    if (this.#isClosing) return Promise.reject(new Error('metadata worker pool is closed'))

    return new Promise((resolve, reject) => {
      this.#queue.push({ id: this.#nextId++, input, resolve, reject })
      this.#dispatch()
    })
  }

  async close (): Promise<void> {
    this.#isClosing = true
    const err = new Error('metadata worker pool closed')
    while (this.#queue.length) this.#queue.shift()?.reject(err)
    await Promise.allSettled([...this.#slots].map(slot => slot.worker.terminate()))
    this.#slots.clear()
    this.#idle = []
  }

  #spawn (filenameFormat: string): void {
    const slot: WorkerSlot = {
      worker: new Worker(new URL('./metadataWorker.js', import.meta.url), {
        workerData: { filenameFormat },
      }),
    }

    slot.worker.on('message', (message) => {
      const task = slot.task
      slot.task = undefined
      if (!task) return

      if (message.ok) task.resolve(message.result)
      else task.reject(new Error(message.error))

      if (!this.#isClosing) {
        this.#idle.push(slot)
        this.#dispatch()
      }
    })

    slot.worker.on('error', (err) => {
      slot.task?.reject(err instanceof Error ? err : new Error(String(err)))
      slot.task = undefined
    })

    slot.worker.on('exit', (code) => {
      this.#slots.delete(slot)
      this.#idle = this.#idle.filter(candidate => candidate !== slot)

      if (slot.task) {
        slot.task.reject(new Error(`metadata worker exited with code ${code}`))
        slot.task = undefined
      }

      if (!this.#isClosing) this.#spawn(filenameFormat)
    })

    this.#slots.add(slot)
    this.#idle.push(slot)
    this.#dispatch()
  }

  #dispatch (): void {
    while (this.#idle.length && this.#queue.length) {
      const slot = this.#idle.shift()
      const task = this.#queue.shift()
      if (!slot || !task) return

      slot.task = task
      slot.worker.postMessage({ id: task.id, input: task.input })
    }
  }
}

export default MetadataWorkerPool
