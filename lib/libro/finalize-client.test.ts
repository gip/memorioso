import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FinalizePublicationError,
  finalizePublicationWithRetry,
  type FinalizePublishPayload,
} from './finalize-client'

const payload: FinalizePublishPayload = {
  registrationId: 'registration-1',
  submissionMethod: 'memorioso_relayer',
  transactionHash: `0x${'ab'.repeat(32)}`,
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.useRealTimers()
})

describe('publication finalization client', () => {
  it('makes three attempts with one- and two-second delays and an identical body', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(503, {
        success: false,
        code: 'FINALIZE_RETRYABLE',
        retryable: true,
        message: 'busy',
      }))
      .mockResolvedValueOnce(response(503, {
        success: false,
        code: 'FINALIZE_RETRYABLE',
        retryable: true,
        message: 'busy',
      }))
      .mockResolvedValueOnce(response(200, { success: true, publicationId: '42' }))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(finalizePublicationWithRetry('/finalize', payload, { fetcher, sleep }))
      .resolves.toEqual({ publicationId: '42' })

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]])
    const bodies = fetcher.mock.calls.map(([, init]) => init?.body)
    expect(new Set(bodies)).toEqual(new Set([JSON.stringify(payload)]))
  })

  it('retries a network failure but not a permanent API error', async () => {
    const networkFetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(200, { success: true, publicationId: '43' }))

    await expect(finalizePublicationWithRetry('/finalize', payload, {
      fetcher: networkFetcher,
      sleep: async () => undefined,
    })).resolves.toEqual({ publicationId: '43' })
    expect(networkFetcher).toHaveBeenCalledTimes(2)

    const permanentFetcher = vi.fn().mockResolvedValue(response(400, {
      success: false,
      message: 'Transaction hash is invalid',
    }))
    await expect(finalizePublicationWithRetry('/finalize', payload, {
      fetcher: permanentFetcher,
    })).rejects.toMatchObject({ retryable: false, status: 400 })
    expect(permanentFetcher).toHaveBeenCalledTimes(1)
  })

  it('aborts an attempt after twenty seconds and exposes a resumable error', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'))
        })
      })
    )
    const pending = finalizePublicationWithRetry('/finalize', payload, {
      attempts: 1,
      fetcher,
    })
    const expectation = expect(pending).rejects.toSatisfy((error: unknown) =>
      error instanceof FinalizePublicationError && error.retryable
    )

    await vi.advanceTimersByTimeAsync(20_000)

    await expectation
    expect(fetcher.mock.calls[0][1]?.signal).toMatchObject({ aborted: true })
  })
})
