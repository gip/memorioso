import { afterEach, describe, expect, it, vi } from 'vitest'
import { retryWithBackoff } from './retry'

afterEach(() => {
  vi.useRealTimers()
})

describe('extension retryWithBackoff', () => {
  it('tries at most three times with the configured delays', async () => {
    const failure = new Error('retryable')
    const operation = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('done')
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(retryWithBackoff(operation, {
      shouldRetry: () => true,
      sleep,
    })).resolves.toBe('done')

    expect(operation).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]])
  })

  it('does not retry a permanent error', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('invalid'))

    await expect(retryWithBackoff(operation, { shouldRetry: () => false }))
      .rejects.toThrow('invalid')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('aborts a stalled attempt after twenty seconds', async () => {
    vi.useFakeTimers()
    const operation = vi.fn((signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const pending = retryWithBackoff(operation, {
      attempts: 1,
      shouldRetry: () => true,
    })
    const expectation = expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    await vi.advanceTimersByTimeAsync(20_000)

    await expectation
    expect(operation.mock.calls[0][0].aborted).toBe(true)
  })
})
