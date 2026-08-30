import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const migrationTable = 'memorioso_schema_migrations'
export const migrationLockId = '7165831947293471'
export const migrationsDirectory = path.join(projectRoot, 'lib/db/migrations')

const SQL_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/
const SIGNED_BIGINT = /^-?[0-9]{1,19}$/

export function createMigrationConfig(input = {}) {
  const directory = path.resolve(projectRoot, input.directory || 'lib/db/migrations')
  const table = input.table || migrationTable
  const lockId = String(input.lockId || migrationLockId)
  const applicationName = input.applicationName || 'memorioso-db-migrate'

  if (!SQL_IDENTIFIER.test(table)) {
    throw new Error('Migration table must be a lowercase PostgreSQL identifier')
  }
  if (!SIGNED_BIGINT.test(lockId)) {
    throw new Error('Migration lock id must be a signed bigint')
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(applicationName)) {
    throw new Error('Migration application name is invalid')
  }

  return { directory, table, lockId, applicationName }
}

export function parseMigrationArguments(args = process.argv.slice(2)) {
  const values = {}
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (!['--directory', '--table', '--lock-id', '--application-name'].includes(name)) {
      throw new Error(`Unknown migration option: ${name}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${name}`)
    }
    values[name] = value
    index += 1
  }
  return createMigrationConfig({
    directory: values['--directory'],
    table: values['--table'],
    lockId: values['--lock-id'],
    applicationName: values['--application-name'],
  })
}

export function parseMigrationFileNames(fileNames) {
  const migrations = fileNames
    .filter((fileName) => fileName.endsWith('.sql'))
    .map((fileName) => {
      const match = /^(\d+)[_-][a-z0-9][a-z0-9_-]*\.sql$/i.exec(fileName)
      if (!match) {
        throw new Error(
          `Invalid migration filename "${fileName}". Expected a numeric prefix, for example 007_add_table.sql.`,
        )
      }

      const version = Number(match[1])
      if (!Number.isSafeInteger(version)) {
        throw new Error(`Migration version in "${fileName}" is too large.`)
      }

      return { fileName, version }
    })
    .sort((left, right) => left.version - right.version || left.fileName.localeCompare(right.fileName))

  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].version === migrations[index].version) {
      throw new Error(
        `Duplicate migration version ${migrations[index].version}: ` +
          `${migrations[index - 1].fileName} and ${migrations[index].fileName}.`,
      )
    }
  }

  return migrations
}

export function buildMigrationPlan(migrations, appliedMigrations) {
  const migrationsByVersion = new Map(migrations.map((migration) => [migration.version, migration]))
  const appliedVersions = new Set()

  for (const appliedMigration of appliedMigrations) {
    const version = Number(appliedMigration.version)
    const migration = migrationsByVersion.get(version)

    if (!migration) {
      throw new Error(
        `Applied migration ${version} (${appliedMigration.name}) is missing from lib/db/migrations.`,
      )
    }

    if (migration.fileName !== appliedMigration.name) {
      throw new Error(
        `Applied migration ${version} was renamed from ${appliedMigration.name} to ${migration.fileName}.`,
      )
    }

    if (migration.checksum !== appliedMigration.checksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${migration.fileName}. ` +
          'Create a new migration instead of editing an applied one.',
      )
    }

    appliedVersions.add(version)
  }

  return migrations.filter((migration) => !appliedVersions.has(migration.version))
}

export async function loadMigrations(config = createMigrationConfig()) {
  const directoryEntries = await readdir(config.directory, { withFileTypes: true })
  const fileNames = directoryEntries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  const migrations = parseMigrationFileNames(fileNames)

  if (migrations.length === 0) {
    throw new Error(`No migration files found in ${config.directory}.`)
  }

  return Promise.all(
    migrations.map(async (migration) => {
      const sql = await readFile(path.join(config.directory, migration.fileName), 'utf8')
      return {
        ...migration,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      }
    }),
  )
}

function loadLocalEnvironment() {
  if (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL) {
    return
  }

  const localEnvironmentPath = path.join(projectRoot, '.env.local')
  if (existsSync(localEnvironmentPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(localEnvironmentPath)
  }
}

export function selectMigrationDatabaseUrl(environment = process.env) {
  const databaseUrl = environment.DATABASE_URL_UNPOOLED || environment.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL_UNPOOLED or DATABASE_URL is required (or add one to .env.local for local development).',
    )
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

export function getDatabaseConnectionString() {
  loadLocalEnvironment()
  return selectMigrationDatabaseUrl()
}

async function ensureMigrationTable(client, table) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.${table} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function getAppliedMigrations(client, table) {
  const result = await client.query(`
    SELECT version, name, checksum
    FROM public.${table}
    ORDER BY version
  `)

  return result.rows
}

export function assertDestructiveMigrationConfirmed(migration, environment = process.env) {
  if (
    migration.version === 13 &&
    environment.MEMORIOSO_DB_BACKUP_CONFIRMED !== '013_session_bound_handles'
  ) {
    throw new Error(
      'Migration 013 is destructive. Back up Postgres, then set ' +
      'MEMORIOSO_DB_BACKUP_CONFIRMED=013_session_bound_handles for this migration run.',
    )
  }
}

async function applyMigration(client, migration, table) {
  assertDestructiveMigrationConfirmed(migration)
  await client.query('BEGIN')

  try {
    await client.query(migration.sql)
    await client.query(
      `
        INSERT INTO public.${table} (version, name, checksum)
        VALUES ($1, $2, $3)
      `,
      [migration.version, migration.fileName, migration.checksum],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export async function migrate(config = createMigrationConfig()) {
  const migrations = await loadMigrations(config)
  const client = new Client({
    connectionString: getDatabaseConnectionString(),
    application_name: config.applicationName,
  })
  let lockAcquired = false

  try {
    await client.connect()
    await client.query("SET lock_timeout TO '60s'")
    await client.query('SET search_path TO public')
    await client.query('SELECT pg_advisory_lock($1::bigint)', [config.lockId])
    lockAcquired = true

    await ensureMigrationTable(client, config.table)
    const appliedMigrations = await getAppliedMigrations(client, config.table)
    const pendingMigrations = buildMigrationPlan(migrations, appliedMigrations)

    if (pendingMigrations.length === 0) {
      console.log('Database is up to date.')
      return
    }

    for (const migration of pendingMigrations) {
      console.log(`Applying ${migration.fileName}...`)
      await applyMigration(client, migration, config.table)
      console.log(`Applied ${migration.fileName}.`)
    }

    console.log(`Applied ${pendingMigrations.length} migration(s).`)
  } finally {
    try {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [config.lockId])
      }
    } finally {
      await client.end()
    }
  }
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  Promise.resolve()
    .then(() => migrate(parseMigrationArguments()))
    .catch((error) => {
    console.error('Database migration failed.')
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
    })
}
