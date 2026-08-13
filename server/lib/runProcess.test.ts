import { describe, expect, it } from 'vitest'
import { ProcessExecutionError, runProcessText } from './runProcess.js'

describe('runProcess', () => {
  it('captures stdout and stderr', async () => {
    const result = await runProcessText(process.execPath, ['-e', 'process.stdout.write(\'out\'); process.stderr.write(\'err\')'])
    expect(result).toEqual({ stdout: 'out', stderr: 'err' })
  })

  it('returns bounded output on failure', async () => {
    const error = await runProcessText(process.execPath, ['-e', 'process.stderr.write(\'failure\'); process.exit(2)'])
      .catch(error => error)
    expect(error).toBeInstanceOf(ProcessExecutionError)
    expect(error.code).toBe(2)
    expect(error.stderr.toString()).toBe('failure')
  })

  it('terminates a timed-out process', async () => {
    await expect(runProcessText(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 20 }))
      .rejects.toThrow('timed out after 20ms')
  })

  it('force-kills a process that ignores graceful termination', async () => {
    const started = Date.now()
    await expect(runProcessText(process.execPath, [
      '-e',
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
    ], { timeoutMs: 50, killGraceMs: 25 }))
      .rejects.toThrow('timed out after 50ms')
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
