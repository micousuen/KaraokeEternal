import childProcess from 'node:child_process'
import path from 'node:path'

export interface RunProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  maxStderrBytes?: number
  maxStdoutBytes?: number
  onStderr?: (chunk: Buffer) => void
  onStdout?: (chunk: Buffer) => void
  rejectOnStdoutOverflow?: boolean
  retryOnNoChildProcess?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ProcessOutput {
  stderr: Buffer
  stdout: Buffer
}

export class ProcessExecutionError extends Error {
  code?: number | string
  signal?: NodeJS.Signals
  stderr: Buffer
  stdout: Buffer

  constructor (message: string, output: ProcessOutput, cause?: unknown) {
    super(message, { cause })
    this.name = 'ProcessExecutionError'
    this.stderr = output.stderr
    this.stdout = output.stdout
  }
}

export async function runProcess (
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<ProcessOutput> {
  const attempts = Math.max(1, options.retryOnNoChildProcess ?? 1)
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await runProcessOnce(command, args, options)
    } catch (error) {
      if (attempt === attempts || !isNoChildProcessError(error)) throw error
    }
  }
  throw new Error(`${path.basename(command)} did not start`)
}

export async function runProcessText (
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<{ stderr: string, stdout: string }> {
  const output = await runProcess(command, args, options)
  return { stderr: output.stderr.toString(), stdout: output.stdout.toString() }
}

export function isNoChildProcessError (error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const stderr = error instanceof ProcessExecutionError ? error.stderr.toString() : ''
  return ('code' in error && error.code === 'ECHILD') || /no child processes/i.test(`${error.message}\n${stderr}`)
}

function runProcessOnce (
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const maxStdout = options.maxStdoutBytes ?? 64 * 1024
    const maxStderr = options.maxStderrBytes ?? 64 * 1024
    let stdoutSize = 0
    let stderrSize = 0
    let settled = false
    let timeout: NodeJS.Timeout | undefined

    const output = (): ProcessOutput => ({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(output())
    }
    const fail = (message: string, cause?: unknown) => {
      const error = new ProcessExecutionError(message, output(), cause)
      if (cause && typeof cause === 'object' && 'code' in cause
        && (typeof cause.code === 'string' || typeof cause.code === 'number')) error.code = cause.code
      finish(error)
    }
    const abort = () => {
      child.kill('SIGTERM')
      fail(`${path.basename(command)} was canceled`)
    }
    const append = (chunks: Buffer[], chunk: Buffer, currentSize: number, maximum: number) => {
      chunks.push(chunk)
      let size = currentSize + chunk.length
      while (size > maximum && chunks.length) {
        const overflow = size - maximum
        if (chunks[0].length <= overflow) size -= chunks.shift()!.length
        else {
          chunks[0] = chunks[0].subarray(overflow)
          size -= overflow
        }
      }
      return size
    }

    child.stdout.on('data', (chunk: Buffer) => {
      options.onStdout?.(chunk)
      stdoutSize += chunk.length
      if (options.rejectOnStdoutOverflow && stdoutSize > maxStdout) {
        child.kill('SIGKILL')
        fail(`${path.basename(command)} output exceeded ${maxStdout} bytes`)
        return
      }
      if (!options.rejectOnStdoutOverflow) stdoutSize = append(stdout, chunk, stdoutSize - chunk.length, maxStdout)
      else stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      options.onStderr?.(chunk)
      stderrSize = append(stderr, chunk, stderrSize, maxStderr)
    })
    child.once('error', error => fail(`Could not start ${command}: ${error.message}`, error))
    child.once('close', (code, signal) => {
      if (code === 0) finish()
      else {
        const reason = code === null ? `signal ${signal || 'unknown'}` : `code ${code}`
        const processOutput = output()
        const detail = processOutput.stderr.toString().trim()
        const error = new ProcessExecutionError(
          `${path.basename(command)} exited with ${reason}${detail ? `: ${detail}` : ''}`,
          processOutput,
        )
        if (code !== null) error.code = code
        if (signal) error.signal = signal
        finish(error)
      }
    })

    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        child.kill('SIGTERM')
        fail(`${path.basename(command)} timed out after ${options.timeoutMs}ms`)
      }, options.timeoutMs)
      timeout.unref()
    }
  })
}
