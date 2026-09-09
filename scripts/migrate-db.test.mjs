import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  assertDestructiveMigrationConfirmed,
  buildMigrationPlan,
  createMigrationConfig,
  parseMigrationArguments,
  parseMigrationFileNames,
  selectMigrationDatabaseUrl,
} from './migrate-db.mjs'

it('requires an explicit backup confirmation for destructive migration 013', () => {
  const migration = { version: 13, fileName: '013_session_bound_handles.sql' }
  expect(() => assertDestructiveMigrationConfirmed(migration, {})).toThrow('Back up Postgres')
  expect(() => assertDestructiveMigrationConfirmed(migration, {
    MEMORIOSO_DB_BACKUP_CONFIRMED: '013_session_bound_handles',
  })).not.toThrow()
  expect(() => assertDestructiveMigrationConfirmed({ version: 12 }, {})).not.toThrow()
})

describe('database migration runner', () => {
  it('accepts an isolated migration directory, table, lock, and application name', () => {
    const config = parseMigrationArguments([
      '--directory', 'libro/service/db/migrations',
      '--table', 'libro_schema_migrations',
      '--lock-id', '7165831947293472',
      '--application-name', 'libro-service-db-migrate',
    ])

    expect(config.directory).toMatch(/libro\/service\/db\/migrations$/)
    expect(config.table).toBe('libro_schema_migrations')
    expect(config.lockId).toBe('7165831947293472')
    expect(config.applicationName).toBe('libro-service-db-migrate')
  })

  it('rejects migration identifiers that could be interpolated as SQL', () => {
    expect(() => createMigrationConfig({ table: 'schema; DROP TABLE users' })).toThrow(
      'lowercase PostgreSQL identifier',
    )
    expect(() => createMigrationConfig({ lockId: '1); SELECT 1' })).toThrow('signed bigint')
  })

  it('discovers migrations in numeric order without requiring consecutive versions', () => {
    expect(
      parseMigrationFileNames([
        '007_libro_extension_signup.sql',
        '006_libro_extension_signing.sql',
        'README.md',
        '001_world_id_4.sql',
        '005_libro_publish_action_hash.sql',
      ]),
    ).toEqual([
      { fileName: '001_world_id_4.sql', version: 1 },
      { fileName: '005_libro_publish_action_hash.sql', version: 5 },
      { fileName: '006_libro_extension_signing.sql', version: 6 },
      { fileName: '007_libro_extension_signup.sql', version: 7 },
    ])
  })

  it('rejects duplicate migration versions', () => {
    expect(() => parseMigrationFileNames(['006_first.sql', '006_second.sql'])).toThrow(
      'Duplicate migration version 6',
    )
  })

  it('returns only migrations that have not been applied', () => {
    const migrations = [
      { version: 1, fileName: '001_first.sql', checksum: 'first' },
      { version: 2, fileName: '002_second.sql', checksum: 'second' },
    ]

    expect(
      buildMigrationPlan(migrations, [{ version: 1, name: '001_first.sql', checksum: 'first' }]),
    ).toEqual([migrations[1]])
  })

  it('rejects changes to an applied migration', () => {
    const migrations = [{ version: 1, fileName: '001_first.sql', checksum: 'changed' }]

    expect(() =>
      buildMigrationPlan(migrations, [
        { version: 1, name: '001_first.sql', checksum: 'original' },
      ]),
    ).toThrow('Checksum mismatch')
  })

  it('prefers the direct migration URL over the pooled runtime URL', () => {
    expect(selectMigrationDatabaseUrl({
      DATABASE_URL: 'postgresql://runtime-pooler.example/database',
      DATABASE_URL_UNPOOLED: 'postgresql://migration-direct.example/database',
    })).toContain('migration-direct.example')
  })

  it('falls back to the runtime URL for local development', () => {
    expect(selectMigrationDatabaseUrl({
      DATABASE_URL: 'postgresql://localhost/memorioso',
    })).toContain('localhost')
  })

  it('ships the one-finalized-registration partial unique index in migration and schema', async () => {
    const [migration, schema] = await Promise.all([
      readFile(new URL('../lib/db/migrations/009_one_finalized_publication_per_draft.sql', import.meta.url), 'utf8'),
      readFile(new URL('../lib/db/schema.sql', import.meta.url), 'utf8'),
    ])

    for (const sql of [migration, schema]) {
      expect(sql).toContain('idx_libro_publish_registrations_one_finalized_draft')
      expect(sql).toContain('WHERE finalized_at IS NOT NULL')
    }
  })

  it('preserves pre-session identities while enforcing complete new session identities', async () => {
    const [migration, schema] = await Promise.all([
      readFile(new URL('../lib/db/migrations/013_session_bound_handles.sql', import.meta.url), 'utf8'),
      readFile(new URL('../lib/db/schema.sql', import.meta.url), 'utf8'),
    ])

    expect(migration).toContain('WITH ranked_authors AS')
    expect(migration).toContain("DEFAULT 'legacy'")
    expect(migration).toContain("SET libro_identity_status = 'session_bound'")
    expect(migration).not.toContain('ALTER COLUMN handle SET NOT NULL')
    expect(migration).not.toContain('ALTER COLUMN world_id_session_id SET NOT NULL')
    for (const sql of [migration, schema]) {
      expect(sql).toContain('users_session_bound_identity_complete')
      expect(sql).toContain("libro_identity_status = 'legacy'")
    }
  })
})
