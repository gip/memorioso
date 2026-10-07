import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ challenge: vi.fn(), query: vi.fn(), context: vi.fn(), connect: vi.fn() }))
vi.mock('./human-publications', () => ({ getSigningChallenge: mocks.challenge }))
vi.mock('./session', () => ({ browserIdentityId: async () => 'identity' }))
vi.mock('./db', () => ({ pool: { query: mocks.query, connect: mocks.connect } }))
vi.mock('./world-id', () => ({ issueRpContext: mocks.context, assertSessionResult: vi.fn(), sessionCommitment: vi.fn(), verifyWithWorld: vi.fn() }))
import { signingContext, prepareSigning } from './human-signing'
const transaction = { chainId: 480, transactions: [{ to: '0x1111111111111111111111111111111111111111', data: '0xabcdef', value: '0x0' }] }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('LIBRO_SERVICE_WRITES_ENABLED', '1')
  vi.stubEnv('NEXT_PUBLIC_LIBRO_V2_REGISTRY_ADDRESS', '')
  mocks.query.mockResolvedValue({ rows: [{ id: 'identity' }] })
  mocks.challenge.mockResolvedValue({ id: 'challenge', identity_id: 'identity', registration_id: 'registration', transaction, transaction_hash: '0x1234', publication_id: '11', publication: { publication_schema: 'libro-publication-v2', libro_protocol_version: 'libro-v1' } })
})
afterEach(() => vi.unstubAllEnvs())
describe('recorded v1 human operations', () => {
  it('returns a prepared v1 transaction without requiring v2 configuration or a second proof', async () => {
    expect(await prepareSigning('capability', null)).toMatchObject({ registrationId: 'registration', transaction, transactionHash: '0x1234', publicationId: '11' })
    expect(await signingContext(new Request('https://libro.test'), 'capability')).toMatchObject({ prepared: { registrationId: 'registration', transaction } })
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
  })
  it('rejects new v1 proof preparation before issuing a World ID context', async () => {
    mocks.challenge.mockResolvedValue({ id: 'challenge', identity_id: 'identity', publication: { publication_schema: 'libro-publication-v2', libro_protocol_version: 'libro-v1' } })
    await expect(signingContext(new Request('https://libro.test'), 'capability')).rejects.toMatchObject({ code: 'PROTOCOL_RETIRED', status: 409 })
    expect(mocks.context).not.toHaveBeenCalled()
  })
})
