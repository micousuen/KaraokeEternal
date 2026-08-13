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
})
