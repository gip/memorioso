import { Pool, type PoolClient } from 'pg'

export type DatabaseClient = Pick<Pool | PoolClient, 'query'>

function databaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required')
  try {
    const url = new URL(value)
    const mode = url.searchParams.get('sslmode')
    if (mode === 'prefer' || mode === 'require' || mode === 'verify-ca') {
      url.searchParams.set('sslmode', 'verify-full')
    }
    return url.toString()
  } catch {
    return value
  }
}

let lazyPool: Pool | undefined

function createPool(): Pool {
  const created = new Pool({
    connectionString: databaseUrl(),
    max: 5,
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
    idleTimeoutMillis: 30_000,
    maxLifetimeSeconds: 5 * 60,
    keepAlive: true,
    application_name: 'libro-service',
  })
  created.on('error', (error) => {
    console.error('Unexpected idle Libro Postgres error', { message: error.message })
  })
  return created
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property) {
    lazyPool ??= createPool()
    const value = Reflect.get(lazyPool, property, lazyPool)
    return typeof value === 'function' ? value.bind(lazyPool) : value
  },
})
