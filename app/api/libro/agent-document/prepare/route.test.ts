import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { canonicalPublicationSignal, hashPublicationSignal } from '@libro/core'
import { createAgentDocumentTypedData } from '@/lib/libro/agent'
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }))
vi.mock('@/lib/db', () => ({ pool: { query: mocks.query, connect: mocks.connect } }))
import { POST } from './route'
const account = privateKeyToAccount(`0x${'12'.repeat(32)}`)
const vector = JSON.parse(readFileSync(new URL('../../../../../libro/core/fixtures/publication-v2-vectors.json', import.meta.url), 'utf8'))[2]
const { publication_registry: _registry, previous_publication: _previous, initially_published_at: _initial, revision_number: _revision, ...fields } = vector.publication
const publication = { ...fields, publication_schema: 'libro-agent-publication-v2', libro_agent_protocol_version: 'libro-agent-v1', agent_address: account.address.toLowerCase() }
const signalHash = hashPublicationSignal(canonicalPublicationSignal(publication))
const nonce = `0x${'ab'.repeat(32)}` as const
const registry = '0x1111111111111111111111111111111111111111'
const transaction = { chainId: 480, transactions: [{ to: registry, data: '0xabcdef', value: '0x0' }] }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('LIBRO_SERVICE_WRITES_ENABLED', '0')
  vi.stubEnv('NEXT_PUBLIC_LIBRO_V1_REGISTRY_ADDRESS', registry)
  vi.stubEnv('NEXT_PUBLIC_LIBRO_V2_REGISTRY_ADDRESS', '')
  mocks.query.mockResolvedValue({ rows: [{ id: 'recorded-operation', registration_hash: publication.agent_registration_hash, document_nonce: nonce,
    registry_address: registry, chain_id: 480, agent_address: account.address.toLowerCase(), transaction, transaction_hash: `0x${'34'.repeat(32)}` }] })
})
afterEach(() => vi.unstubAllEnvs())
async function request(signer = account, documentNonce: `0x${string}` = nonce) {
  const signedAt = Math.floor(Date.now() / 1000)
  const signature = await signer.signTypedData(createAgentDocumentTypedData({ chainId: 480, registryAddress: registry,
    registrationHash: publication.agent_registration_hash, documentSignalHash: signalHash, documentNonce, signedAt }))
  return new NextRequest('https://memorioso.xyz/api/libro/agent-document/prepare', { method: 'POST', body: JSON.stringify({ publication, documentNonce, signedAt, signature }) })
}
describe('local v1 agent operation recovery', () => {
  it('resumes the frozen transaction using a fresh v1-domain signature with no v2 configuration', async () => {
    const response = await POST(await request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, documentRegistrationId: 'recorded-operation', transaction })
    expect(mocks.connect).not.toHaveBeenCalled()
  })
  it('rejects a different agent key even when the publication hash is known', async () => {
    expect((await POST(await request(privateKeyToAccount(`0x${'56'.repeat(32)}`)))).status).toBe(401)
  })
  it('rejects replacing the stored operation nonce', async () => {
    expect((await POST(await request(account, `0x${'cd'.repeat(32)}`))).status).toBe(409)
  })
})
