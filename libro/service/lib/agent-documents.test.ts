import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Hex } from 'viem'
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), recover: vi.fn() }))
vi.mock('./db', () => ({ pool: { query: mocks.query, connect: mocks.connect } }))
vi.mock('@libro/core', async original => ({ ...await original<object>(), recoverLibroAgentDocumentSigner: mocks.recover }))
import { prepareAgentDocument } from './agent-documents'
const vector = JSON.parse(readFileSync(new URL('../../core/fixtures/publication-v2-vectors.json', import.meta.url), 'utf8'))[2]
const nonce = `0x${'ab'.repeat(32)}`
const prepared = { id: 'document-id', document_signal_hash: vector.signalHash, registration_hash: vector.publication.agent_registration_hash,
  document_nonce: nonce, agent_address: vector.publication.agent_address, chain_id: 480, registry_address: vector.publication.publication_registry,
  transaction: { chainId: 480, transactions: [{ to: vector.publication.publication_registry, data: '0xabcdef', value: '0x0' }] },
  transaction_hash: `0x${'12'.repeat(32)}`, publication_id: '11' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('LIBRO_SERVICE_WRITES_ENABLED', '1')
  vi.stubEnv('NEXT_PUBLIC_LIBRO_V1_REGISTRY_ADDRESS', '0x1111111111111111111111111111111111111111')
  vi.stubEnv('NEXT_PUBLIC_LIBRO_V2_REGISTRY_ADDRESS', '0x2222222222222222222222222222222222222222')
  mocks.query.mockResolvedValue({ rows: [prepared] })
  mocks.recover.mockResolvedValue(prepared.agent_address)
})
afterEach(() => vi.unstubAllEnvs())
const input = () => ({ publication: vector.publication, documentNonce: nonce, signedAt: Math.floor(Date.now() / 1000), signature: `0x${'ff'.repeat(65)}` as Hex })
describe('agent publication retry recovery', () => {
  it('resumes the exact frozen transaction beyond the publication-date window without checking the current head', async () => {
    expect(await prepareAgentDocument(input())).toEqual({ documentRegistrationId: prepared.id, documentSignalHash: vector.signalHash,
      transaction: prepared.transaction, transactionHash: prepared.transaction_hash, publicationId: '11' })
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.recover.mock.calls[0][0].domain.verifyingContract).toBe(prepared.registry_address)
  })
  it('requires the same agent key even for an already finalized operation', async () => {
    mocks.recover.mockResolvedValue('0x4444444444444444444444444444444444444444')
    await expect(prepareAgentDocument(input())).rejects.toMatchObject({ code: 'INVALID_SIGNATURE', status: 401 })
  })
  it('rejects a different nonce instead of replacing the frozen operation', async () => {
    await expect(prepareAgentDocument({ ...input(), documentNonce: `0x${'cd'.repeat(32)}` })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
  })
})
