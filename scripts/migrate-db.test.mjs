import { describe, expect, it } from 'vitest'
import { buildMigrationPlan, parseMigrationFileNames } from './migrate-db.mjs'

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
})
