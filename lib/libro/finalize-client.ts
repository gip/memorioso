export type FinalizePublishPayload = {
  registrationId: string
  submissionMethod: 'world_wallet' | 'memorioso_relayer'
  userOpHash?: string
  transactionHash: string
}

type FinalizePublishResponse =
  | { success: true; publicationId: string; publicationType?: 'short' | 'article' }
  | {
      success: false
      message?: string
      code?: string
      retryable?: boolean
    }

type FinalizeRequestOptions = {
  attempts?: number
  delaysMs?: number[]
  timeoutMs?: number
  fetcher?: typeof fetch
  sleep?: (delayMs: number) => Promise<void>
}

export class FinalizePublicationError extends Error {
  readonly retryable: boolean
  readonly status?: number
  readonly code?: string

  constructor(message: string, options: { retryable: boolean; status?: number; code?: string }) {
    super(message)
    this.name = 'FinalizePublicationError'
    this.retryable = options.retryable
    this.status = options.status
    this.code = options.code
  }
}

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs)
})

export async function finalizePublicationWithRetry(
  url: string,
  payload: FinalizePublishPayload,
  options: FinalizeRequestOptions = {}
): Promise<{ publicationId: string; publicationType?: 'short' | 'article' }> {
  const attempts = options.attempts ?? 3
  const delaysMs = options.delaysMs ?? [1_000, 2_000]
  const timeoutMs = options.timeoutMs ?? 20_000
  const fetcher = options.fetcher ?? fetch
  const sleep = options.sleep ?? defaultSleep
  let lastError: FinalizePublicationError | null = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetcher(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const body = await response.json().catch(() => ({})) as FinalizePublishResponse

      if (response.ok && body.success) {
        return { publicationId: body.publicationId, publicationType: body.publicationType }
      }

      const retryable = !body.success && body.code === 'FINALIZE_RETRYABLE' && body.retryable === true
      lastError = new FinalizePublicationError(
        !body.success && body.message
          ? body.message
          : `Publication finalization returned ${response.status}`,
        {
          retryable,
          status: response.status,
          ...(!body.success && body.code ? { code: body.code } : {}),
        }
      )
    } catch (error) {
      lastError = error instanceof FinalizePublicationError
        ? error
        : new FinalizePublicationError(
            error instanceof Error ? error.message : 'Publication finalization could not be reached',
            { retryable: true }
          )
    } finally {
      clearTimeout(timeout)
    }

    if (!lastError.retryable || attempt === attempts - 1) throw lastError
    await sleep(delaysMs[attempt] ?? delaysMs.at(-1) ?? 0)
  }

  throw lastError || new FinalizePublicationError('Publication finalization failed', { retryable: false })
}
