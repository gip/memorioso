import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { copyAll } from './migrate-to-libro-service.mjs'

const url = process.env.LIBRO_TEST_DATABASE_URL
const sourceSchema = `legacy_source_${process.pid}`
const targetSchema = `legacy_target_${process.pid}`
const authorId = randomUUID()
const proof = { proof: '0x1234', merkle_root: '0x12', nullifier_hash: '0x34', verification_level: 'orb' }
const signal = { author_id_libro: authorId, author_name_libro: 'Historical author', author_bio_libro: '',
  publication_date: '2024-01-01T12:00:00.000Z', publication_title: 'Historical text',
  publication_subtitle: '', publication_content: { html: '<p>Unchanged legacy prose</p>' } }
let source, target

describe('migration namespace preflight', () => {
  afterEach(() => vi.unstubAllEnvs())
  it.each([false, true])('rejects invalid namespace configuration before database access (dryRun=%s)', async (dryRun) => {
    vi.stubEnv('LIBRO_OAUTH_CLIENT_ID', 'memorioso')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://memorioso.test')
    const database = { query: vi.fn() }
    for (const namespace of ['https://memorioso.test/authors', 'https://another.test']) {
      vi.stubEnv('LIBRO_AUTHOR_NAMESPACE', namespace)
      await expect(copyAll(database, database, { dryRun })).rejects.toThrow()
    }
    expect(database.query).not.toHaveBeenCalled()
  })
})

describe.skipIf(!url)('legacy publication copy with Postgres', () => {
  beforeAll(async () => {
    source = new pg.Client({ connectionString: url }); target = new pg.Client({ connectionString: url })
    await source.connect(); await target.connect()
    await source.query(`CREATE SCHEMA ${sourceSchema}`); await target.query(`CREATE SCHEMA ${targetSchema}`)
    await source.query(`SET search_path TO ${sourceSchema},public`); await target.query(`SET search_path TO ${targetSchema},public`)
    await source.query(await readFile(new URL('../lib/db/schema.sql', import.meta.url), 'utf8'))
    await target.query(await readFile(new URL('../libro/service/db/schema.sql', import.meta.url), 'utf8'))
    const user = (await source.query("INSERT INTO users (name,handle,libro_identity_status) VALUES ('Legacy','historical','legacy') RETURNING id")).rows[0].id
    await source.query('INSERT INTO authors (id,"userId",name,handle) VALUES ($1,$2,$3,$4)', [authorId,user,'Historical author','historical'])
    await source.query(`INSERT INTO publications (id,"authorId",signal,proof,version,title,subtitle,content,date,"userId")
      VALUES (7,$1,$2,$3,'1',$4,'',$5,$6,$7)`, [authorId,signal,proof,signal.publication_title,signal.publication_content,signal.publication_date,user])
  })
  afterAll(async () => {
    if(source) { await source.query(`DROP SCHEMA IF EXISTS ${sourceSchema} CASCADE`); await source.end() }
    if(target) { await target.query(`DROP SCHEMA IF EXISTS ${targetSchema} CASCADE`); await target.end() }
  })
  it('dry runs without writes, then copies idempotently without inventing an identity or changing proofs', async () => {
    const dry = await copyAll(source,target,{dryRun:true,linkSourceIdentities:false})
    expect(dry.legacyPublications).toBe(1)
    expect((await target.query('SELECT COUNT(*)::int count FROM libro_publications')).rows[0].count).toBe(0)
    for(let i=0;i<2;i++) {
      const result = await copyAll(source,target,{dryRun:false,linkSourceIdentities:true})
      expect(result.legacyPublications).toBe(1); expect(result.legacyAuthors).toBe(1)
    }
    const saved = (await target.query('SELECT * FROM libro_publications WHERE id=7')).rows[0]
    expect(saved.signal).toEqual(signal); expect(saved.proof).toEqual(proof)
    expect(saved.identity_id).toBeNull(); expect(saved.legacy_proof).toBe(true)
    expect((await target.query('SELECT COUNT(*)::int count FROM libro_identities')).rows[0].count).toBe(0)
    expect((await target.query('SELECT identity_id FROM libro_authors')).rows[0].identity_id).toBeNull()
    expect((await source.query('SELECT signal_hash FROM publication_policies WHERE publication_id=7')).rows[0].signal_hash).toBe(saved.signal_hash)
    await source.query("UPDATE publications SET access='gated' WHERE id=7")
    expect((await source.query('SELECT access FROM publication_policies WHERE publication_id=7')).rows[0].access).toBe('gated')
    expect((await target.query("SELECT nextval(pg_get_serial_sequence('libro_publications','id')) id")).rows[0].id).toBe('8')
  })
  it('does not reinterpret a malformed modern proof as a historical proof', async () => {
    await source.query("UPDATE publications SET proof=proof || '{\"protocol_version\":\"4.0\"}'::jsonb WHERE id=7")
    await expect(copyAll(source,target,{dryRun:true,linkSourceIdentities:false})).rejects.toThrow()
  })
})
