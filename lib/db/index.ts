import { Pool } from 'pg'

function getDatabaseConnectionString(): string {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  try {
    const url = new URL(databaseUrl)
    const sslMode = url.searchParams.get('sslmode')

    if (sslMode === 'prefer' || sslMode === 'require' || sslMode === 'verify-ca') {
      url.searchParams.set('sslmode', 'verify-full')
    }

    return url.toString()
  } catch {
    return databaseUrl
  }
}

export const pool = new Pool({
  connectionString: getDatabaseConnectionString(),
  max: 5,
  connectionTimeoutMillis: 10_000,
  query_timeout: 20_000,
  idleTimeoutMillis: 30_000,
  maxLifetimeSeconds: 5 * 60,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  application_name: 'memorioso-web',
})

pool.on('error', (error) => {
  const code = (error as Error & { code?: unknown }).code
  console.error('Unexpected idle Postgres client error', {
    code: typeof code === 'string' ? code : undefined,
    message: error.message,
  })
})
