import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  getDatabaseConnectionString,
  loadMigrations,
  migrationLockId,
  migrationTable,
} from './migrate-db.mjs'

const { Client } = pg

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = path.join(projectRoot, 'lib/db/schema.sql')

export function assertDatabaseCanBeInitialized(relations, appliedMigrations) {
  const applicationRelations = relations.filter((relation) => relation.name !== migrationTable)

  if (applicationRelations.length > 0) {
    const names = applicationRelations.map((relation) => relation.name).join(', ')
    throw new Error(
      `Database is not empty. Refusing to initialize it. Found public relations: ${names}.`,
    )
  }

  if (appliedMigrations.length > 0) {
    throw new Error(
      `Database already records ${appliedMigrations.length} applied migration(s). ` +
        'Use pnpm db:migrate instead.',
    )
  }
}

async function getPublicRelations(client) {
  const result = await client.query(`
    SELECT relation.relname AS name
    FROM pg_class relation
    INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ORDER BY relation.relname
  `)

  return result.rows
}

async function getAppliedMigrationsIfPresent(client, relations) {
  if (!relations.some((relation) => relation.name === migrationTable)) {
    return []
  }

  const result = await client.query(`
    SELECT version, name
    FROM public.${migrationTable}
    ORDER BY version
  `)

  return result.rows
}

async function createMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.${migrationTable} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export async function initializeDatabase() {
  const [schema, migrations] = await Promise.all([
    readFile(schemaPath, 'utf8'),
    loadMigrations(),
  ])
  const client = new Client({
    connectionString: getDatabaseConnectionString(),
    application_name: 'memorioso-db-init',
  })
  let lockAcquired = false

  try {
    await client.connect()
    await client.query("SET lock_timeout TO '60s'")
    await client.query('SET search_path TO public')
    await client.query('SELECT pg_advisory_lock($1::bigint)', [migrationLockId])
    lockAcquired = true
    await client.query('BEGIN')

    try {
      const relations = await getPublicRelations(client)
      const appliedMigrations = await getAppliedMigrationsIfPresent(client, relations)
      assertDatabaseCanBeInitialized(relations, appliedMigrations)

      await client.query(schema)
      await createMigrationTable(client)

      for (const migration of migrations) {
        await client.query(
          `
            INSERT INTO public.${migrationTable} (version, name, checksum)
            VALUES ($1, $2, $3)
          `,
          [migration.version, migration.fileName, migration.checksum],
        )
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }

    console.log(
      `Initialized the database from lib/db/schema.sql and baselined ${migrations.length} migration(s).`,
    )
  } finally {
    try {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [migrationLockId])
      }
    } finally {
      await client.end()
    }
  }
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  initializeDatabase().catch((error) => {
    console.error('Database initialization failed.')
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
