import { describe, expect, it } from 'vitest'
import { assertDatabaseCanBeInitialized } from './init-db.mjs'

describe('fresh database initialization', () => {
  it('accepts an empty public schema', () => {
    expect(() => assertDatabaseCanBeInitialized([], [])).not.toThrow()
  })

  it('accepts an empty migration ledger left by an earlier failed migration run', () => {
    expect(() =>
      assertDatabaseCanBeInitialized([{ name: 'memorioso_schema_migrations' }], []),
    ).not.toThrow()
  })

  it('refuses to initialize a database with application relations', () => {
    expect(() => assertDatabaseCanBeInitialized([{ name: 'users' }], [])).toThrow(
      'Database is not empty',
    )
  })

  it('refuses to initialize a database with recorded migrations', () => {
    expect(() =>
      assertDatabaseCanBeInitialized(
        [{ name: 'memorioso_schema_migrations' }],
        [{ version: 1, name: '001_world_id_4.sql' }],
      ),
    ).toThrow('already records 1 applied migration')
  })
})
