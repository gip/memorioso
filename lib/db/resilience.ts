import type { PoolClient } from 'pg'

const RETRYABLE_DATABASE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '55P03', // lock_not_available / lock_timeout
  '57014', // query_canceled / statement_timeout
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
])

const CONNECTION_ERROR_PATTERN =
  /connection|econnreset|econnrefused|etimedout|enotfound|eai_again|socket|query read timeout|timeout exceeded when trying to connect|terminat(?:ed|ing)/i

type ErrorWithCode = Error & { code?: string }

export type DatabaseFailure = {
  code?: string
  message: string
  retryable: boolean
  destroyConnection: boolean
}

function asError(error: unknown): ErrorWithCode {
  return error instanceof Error ? error as ErrorWithCode : new Error(String(error))
}

export function describeDatabaseFailure(error: unknown): DatabaseFailure {
  const parsed = asError(error)
  const code = typeof parsed.code === 'string' ? parsed.code : undefined
  const connectionFailure = code?.startsWith('08') === true ||
    (code ? CONNECTION_ERROR_PATTERN.test(code) : false) ||
    CONNECTION_ERROR_PATTERN.test(parsed.message)

  return {
    ...(code ? { code } : {}),
    message: parsed.message,
    retryable: connectionFailure || (code ? RETRYABLE_DATABASE_CODES.has(code) : false),
    destroyConnection: connectionFailure,
  }
}

export async function configureLibroWriteTransaction(client: PoolClient): Promise<void> {
  // SET LOCAL is transaction-scoped and safe with Neon's PgBouncer transaction pooling.
  // Do not move these settings into connection startup parameters.
  await client.query(`
    SET LOCAL lock_timeout = '3s';
    SET LOCAL statement_timeout = '15s';
    SET LOCAL idle_in_transaction_session_timeout = '15s'
  `)
}

/**
 * End a failed transaction without letting a broken socket or rollback error mask the cause.
 * Returns true because the client is always released by this helper.
 */
export async function rollbackAndRelease(
  client: PoolClient,
  error: unknown,
  transactionOpen: boolean
): Promise<true> {
  const failure = describeDatabaseFailure(error)
  const originalError = asError(error)

  if (!transactionOpen || failure.destroyConnection) {
    client.release(originalError)
    return true
  }

  const rollback = client.query('ROLLBACK').then(
    () => ({ succeeded: true as const }),
    (rollbackError: unknown) => ({ succeeded: false as const, rollbackError })
  )
  let rollbackTimer: ReturnType<typeof setTimeout> | undefined
  const rollbackTimeout = new Promise<{ succeeded: false; timedOut: true }>((resolve) => {
    rollbackTimer = setTimeout(() => resolve({ succeeded: false, timedOut: true }), 1_000)
  })
  const rollbackResult = await Promise.race([rollback, rollbackTimeout])
  if (rollbackTimer) clearTimeout(rollbackTimer)

  if (rollbackResult.succeeded) {
    client.release()
  } else if ('timedOut' in rollbackResult) {
    client.release(originalError)
  } else {
    client.release(asError(rollbackResult.rollbackError))
  }

  return true
}
