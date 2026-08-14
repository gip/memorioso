import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  assertDestructiveMigrationConfirmed,
  buildMigrationPlan,
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
})
