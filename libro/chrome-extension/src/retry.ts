export type RetryOptions = {
  attempts?: number
  delaysMs?: number[]
  timeoutMs?: number
  sleep?: (delayMs: number) => Promise<void>
  shouldRetry: (error: unknown) => boolean
}

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs)
})

export async function retryWithBackoff<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const attempts = options.attempts ?? 3
  const delaysMs = options.delaysMs ?? [1_000, 2_000]
  const timeoutMs = options.timeoutMs ?? 20_000
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await operation(controller.signal)
    } catch (error) {
      if (!options.shouldRetry(error) || attempt === attempts - 1) throw error
    } finally {
      clearTimeout(timeout)
    }
    await sleep(delaysMs[attempt] ?? delaysMs.at(-1) ?? 0)
  }

  throw new Error('Retry attempts were exhausted')
}
