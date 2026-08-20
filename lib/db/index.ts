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

function createPool(): Pool {
  const created = new Pool({
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

  created.on('error', (error) => {
    const code = (error as Error & { code?: unknown }).code
    console.error('Unexpected idle Postgres client error', {
      code: typeof code === 'string' ? code : undefined,
      message: error.message,
    })
  })

  return created
}

let lazyPool: Pool | undefined

/**
 * The pool is built on first use rather than on import. `next build` collects page
 * data for every route that imports this module, so constructing it eagerly turned a
 * missing DATABASE_URL into a build failure on hosts that have no database at all
 * (preview and Openship sandbox builds). Missing-env failures stay explicit: the
 * error is thrown when something actually tries to talk to Postgres.
 */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property) {
    lazyPool ??= createPool()
    const value = Reflect.get(lazyPool, property, lazyPool)
    return typeof value === 'function' ? value.bind(lazyPool) : value
  },
})
