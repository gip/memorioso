import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { hashLibroHandle, LIBRO_PROTOCOL_VERSION, LIBRO_PUBLICATION_SCHEMA_V1 } from '@libro/core'

const test = vi.hoisted(() => {
  const url = process.env.LIBRO_TEST_DATABASE_URL
  const schema = `p1_service_${process.pid}`
  if (url) {
    const scoped = new URL(url)
    scoped.searchParams.set('options', `-c search_path=${schema},public`)
    process.env.DATABASE_URL = scoped.toString()
  }
  return { url, schema, identity: '', verifyHuman: vi.fn(), verifyAgent: vi.fn(), verifyRevoke: vi.fn() }
})
vi.mock('./session', async (original) => ({ ...await original<object>(), browserIdentityId: async () => test.identity }))
vi.mock('./chain', async (original) => ({ ...await original<object>(),
  verifyHumanRegistration: test.verifyHuman, verifyAgentRegistration: test.verifyAgent, verifyAgentRevocation: test.verifyRevoke,
}))
import { pool } from './db'
import { createHumanChallenge, getSigningChallenge } from './human-publications'
import { finalizeSigning, prepareSigning, signingContext, recordWalletSubmission } from './human-signing'
import { createAgentRegistrationChallenge, finalizeAgentSigning } from './agent-registrations'
import { revokeAgent } from './agent-revocation'
import { authenticateBearer, assertPrincipalScope, exchangeAuthorizationCode, issueAuthorizationCode, type OAuthPrincipal } from './oauth'
import { POST as mcp } from '../app/mcp/route'
import { verifyIdentity } from './world-id'
import { POST as loginContext } from '../app/api/v1/identity/context/route'

const hash = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`
const sessionId = `session_${'1'.repeat(64)}${'2'.repeat(64)}`
let principal: OAuthPrincipal
let admin: Pool

// Opt-in: uses an isolated schema in the explicitly supplied test database; never the app database.
describe.skipIf(!test.url)('Libro cutover with Postgres', () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: test.url })
    await admin.query(`CREATE SCHEMA ${test.schema}`)
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
    process.env.LIBRO_SERVICE_WRITES_ENABLED = '1'
    process.env.LIBRO_SERVICE_URL = 'https://libro.test'
    process.env.LIBRO_MCP_STATE_SECRET = 'test-mcp-secret-at-least-thirty-two-bytes'
    process.env.LIBRO_SIGNING_CAPABILITY_SECRET = 'test-signing-secret-at-least-thirty-two-bytes'
    process.env.NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS = `0x${'1'.repeat(40)}`
    process.env.LIBRO_WEBHOOK_DESTINATIONS = '[]'
    process.env.NEXT_PUBLIC_WORLD_ID_APP_ID = `app_${'1'.repeat(32)}`
    process.env.WORLD_ID_RP_ID = 'rp_0000000000000001'
    process.env.WORLD_ID_RP_SIGNING_KEY = hash('1')
    process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT = 'production'
  })
  afterAll(async () => {
    await pool.end()
    await admin.query(`DROP SCHEMA ${test.schema} CASCADE`)
    await admin.end()
    vi.unstubAllGlobals()
  })
  beforeEach(async () => {
    const tables = await pool.query('SELECT tablename FROM pg_tables WHERE schemaname = $1', [test.schema])
    await pool.query(`TRUNCATE ${tables.rows.map((row) => `"${test.schema}"."${row.tablename}"`).join(',')} CASCADE`)
    test.verifyHuman.mockResolvedValue(true)
    test.verifyAgent.mockResolvedValue(true)
    test.verifyRevoke.mockResolvedValue(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true })))
    test.identity = randomUUID()
    await pool.query(`INSERT INTO libro_identities (id, world_id_session_id, session_commitment, credential_identifier)
      VALUES ($1,$2,$3,'proof_of_human')`, [test.identity, sessionId, hash('1')])
    await pool.query("INSERT INTO libro_authors (id, identity_id, name, handle) VALUES ($1,$1,'Ada','ada')", [test.identity])
    await pool.query(`INSERT INTO libro_oauth_clients (id, client_type, redirect_uris, resource)
      VALUES ('client','public',ARRAY['https://client.test/callback'],'https://libro.test/mcp')`)
    principal = { identityId: test.identity, authorId: test.identity, name: 'Ada', handle: 'ada', bio: '',
      sessionCommitment: hash('1'), clientId: 'client', resource: 'https://libro.test/mcp',
      scope: ['profile', 'publish', 'register_agent', 'revoke_agent'], authorNamespace: null, verifiedAt: new Date().toISOString() }
  })

  async function challenge() {
    const publication = { publication_schema: LIBRO_PUBLICATION_SCHEMA_V1, libro_protocol_version: LIBRO_PROTOCOL_VERSION,
      world_id_protocol_version: '4.0', world_id_proof_type: 'session', world_id_credential_policy: 'orb',
      author_id_libro: test.identity, author_name_libro: 'Ada', author_handle_libro: 'ada', author_handle_hash_libro: hashLibroHandle('ada'),
      author_bio_libro: '', publication_date: new Date().toISOString(), publication_title: randomUUID(), publication_subtitle: '',
      publication_content: { html: '<p>Human writing.</p>' } }
    const value = await createHumanChallenge({ principal, publication })
    const capability = new URL(value.signingUrl).pathname.split('/').pop()!
    const row = (await pool.query('SELECT * FROM libro_publish_challenges WHERE id = $1', [value.challengeId])).rows[0]
    await pool.query(`INSERT INTO libro_rp_contexts (nonce,purpose,identity_id,object_id,expected_signal_hash,expected_session_commitment,expires_at)
      VALUES ($1,'publish',$2,$3,$4,$5,CURRENT_TIMESTAMP + INTERVAL '5 minutes')`, [row.nonce,test.identity,row.id,row.signal_hash,hash('1')])
    const proof = { protocol_version: '4.0', nonce: row.nonce, environment: 'production', session_id: sessionId,
      responses: [{ identifier: 'proof_of_human', proof: ['1','2','3','4','5'], session_nullifier: ['10','11'],
        expires_at_min: 999999999, issuer_schema_id: 1, signal_hash: row.signal_hash }] }
    return { value, capability, proof }
  }

  it('records an implicit claim and prepares the second publication without claiming again', async () => {
    const first = await challenge()
    const prepared = await prepareSigning(first.capability, first.proof)
    await finalizeSigning(first.capability, { registrationId: prepared.registrationId, submissionMethod: 'world_wallet', transactionHash: hash('a') })
    expect((await pool.query('SELECT * FROM libro_handle_claims')).rows).toHaveLength(1)
    const second = await challenge()
    const next = await prepareSigning(second.capability, second.proof)
    expect(next.transaction.transactions[0].data.slice(0,10)).not.toBe(prepared.transaction.transactions[0].data.slice(0,10))
  })

  it('recovers a prepared expired challenge and retries a consumed finalization idempotently', async () => {
    const item = await challenge()
    const prepared = await prepareSigning(item.capability, item.proof)
    await recordWalletSubmission(item.capability, prepared.registrationId, hash('b'))
    await pool.query("UPDATE libro_publish_challenges SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'")
    const resume = await signingContext(new Request('https://libro.test'), item.capability)
    expect(resume).toMatchObject({ prepared: { registrationId: prepared.registrationId, userOpHash: hash('b') } })
    const input = { registrationId: prepared.registrationId, submissionMethod: 'world_wallet' as const, transactionHash: hash('c') }
    const first = await finalizeSigning(item.capability, input)
    expect(await finalizeSigning(item.capability, input)).toEqual(first)
    expect((await pool.query('SELECT * FROM libro_publications')).rows).toHaveLength(1)
    expect((await pool.query('SELECT * FROM libro_service_events')).rows).toHaveLength(1)
  })

  it('rejects unprepared expired challenges and recovery by another identity', async () => {
    const item = await challenge()
    test.identity = randomUUID()
    await expect(signingContext(new Request('https://libro.test'), item.capability)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
    await pool.query("UPDATE libro_publish_challenges SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'")
    await expect(getSigningChallenge(item.capability)).rejects.toMatchObject({ code: 'INVALID_CAPABILITY' })
  })

  it('records an implicit agent claim and verifies revocation before updating the database', async () => {
    const item = await createAgentRegistrationChallenge({ principal, controllerAddress: `0x${'2'.repeat(40)}`,
      agentAddress: `0x${'3'.repeat(40)}`, expiresAt: new Date(Date.now()+3600000).toISOString() })
    const capability = new URL(item.signingUrl).pathname.split('/').pop()!
    await finalizeAgentSigning(capability, { transactionHash: hash('d') })
    expect((await pool.query('SELECT * FROM libro_handle_claims')).rows).toHaveLength(1)
    test.verifyRevoke.mockResolvedValue(false)
    await expect(revokeAgent(principal, item.registrationId, hash('e'))).rejects.toMatchObject({ code: 'REGISTRATION_PENDING' })
    expect((await pool.query('SELECT revoked_at FROM libro_agent_registrations')).rows[0].revoked_at).toBeNull()
    await expect(revokeAgent({ ...principal, identityId: randomUUID() }, item.registrationId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    test.verifyRevoke.mockResolvedValue(true)
    expect(await revokeAgent(principal, item.registrationId, hash('e'))).toMatchObject({ revoked: true })
    expect((await pool.query('SELECT revoked_at FROM libro_agent_registrations')).rows[0].revoked_at).not.toBeNull()
  })

  it('preserves actual verification age when issuing a grant and rejects stale MCP writes', async () => {
    await pool.query("UPDATE libro_identities SET verified_at = CURRENT_TIMESTAMP - INTERVAL '25 hours'")
    const verifier = 'x'.repeat(43)
    const code = await issueAuthorizationCode({ clientId: 'client', identityId: test.identity, redirectUri: 'https://client.test/callback',
      resource: principal.resource, scope: principal.scope, codeChallenge: createHash('sha256').update(verifier).digest('base64url') })
    const issued = await exchangeAuthorizationCode(new Request('https://libro.test/oauth/token'), new URLSearchParams({
      code, client_id: 'client', redirect_uri: 'https://client.test/callback', resource: principal.resource, code_verifier: verifier,
    }))
    const request = new Request('https://libro.test/mcp', { headers: { Authorization: `Bearer ${issued.accessToken}` } })
    const identified = await authenticateBearer(request)
    expect(() => assertPrincipalScope(identified, 'publish')).toThrowError('Verify with World ID again')
    await expect(authenticateBearer(request, 'publish')).rejects.toMatchObject({ code: 'invalid_token' })
    expect(() => assertPrincipalScope(identified, 'profile')).not.toThrow()
    const response = await mcp(new Request('https://libro.test/mcp', { method:'POST',
      headers: { Authorization: `Bearer ${issued.accessToken}`, 'Content-Type':'application/json', Accept:'application/json, text/event-stream', 'MCP-Protocol-Version':'2025-06-18' },
      body: JSON.stringify({ jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'publish_human',arguments:{publication:{}}} }),
    }))
    const wire = await response.text()
    const body = JSON.parse(wire.startsWith('event:') || wire.startsWith('data:') ? wire.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : wire)
    expect(JSON.parse(body.result.content[0].text).error.code).toBe('REAUTH_REQUIRED')
    expect((await pool.query('SELECT * FROM libro_publish_challenges')).rows).toHaveLength(0)
  })

  it('starts migrated-user login without cookies and rejects a proof for another session', async () => {
    const response = await loginContext(new Request('https://libro.test/api/v1/identity/context', {
      method: 'POST', body: JSON.stringify({ purpose: 'login', handle: 'ada' }),
    }))
    expect(response.status).toBe(200)
    const context = await response.json()
    expect(context.existingSessionId).toBe(sessionId)
    const payload = { protocol_version: '4.0', nonce: context.rpContext.nonce, environment: 'production',
      session_id: `session_${'3'.repeat(128)}`, responses: [{ identifier: 'proof_of_human', proof: [], session_nullifier: ['1','2'] }] }
    await expect(verifyIdentity({ payload, purpose: 'login' })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
    expect(fetch).not.toHaveBeenCalled()
    payload.session_id = sessionId
    expect(await verifyIdentity({ payload, purpose: 'login' })).toMatchObject({ identityId: test.identity, created: false })
    await expect(verifyIdentity({ payload, purpose: 'login' })).rejects.toMatchObject({ code: 'INVALID_CONTEXT' })
  })
})
