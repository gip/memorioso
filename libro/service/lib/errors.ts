import type { LibroServiceError } from '@libro/core'

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

export function errorResponse(error: unknown): Response {
  const parsed = error instanceof ServiceError
    ? error
    : new ServiceError('INTERNAL_ERROR', 'Libro service request failed', 500, false)
  const body: LibroServiceError = {
    error: { code: parsed.code, message: parsed.message, retryable: parsed.retryable },
  }
  const headers = new Headers()
  if (parsed.retryable) {
    headers.set('Retry-After', '1')
    headers.set('Cache-Control', 'no-store')
  }
  if (parsed.status === 401 && process.env.LIBRO_SERVICE_URL) {
    const metadata = new URL('/.well-known/oauth-protected-resource', process.env.LIBRO_SERVICE_URL).toString()
    headers.set('WWW-Authenticate', `Bearer resource_metadata="${metadata}"`)
  }
  return Response.json(body, {
    status: parsed.status,
    headers,
  })
}

export function assertWritesEnabled(): void {
  if (process.env.LIBRO_SERVICE_WRITES_ENABLED !== '1') {
    throw new ServiceError('WRITES_DISABLED', 'Libro writes are disabled during cutover', 503, true)
  }
}
