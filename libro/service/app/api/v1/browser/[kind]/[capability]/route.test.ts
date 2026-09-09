import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ identity: vi.fn(), publication: vi.fn(), agent: vi.fn(), claim: vi.fn() }))
vi.mock('@/lib/session', () => ({ browserIdentityId: mocks.identity }))
vi.mock('@/lib/human-publications', () => ({ getSigningChallenge: mocks.publication }))
vi.mock('@/lib/agent-registrations', () => ({ getAgentRegistrationSigningChallenge: mocks.agent }))
vi.mock('@/lib/handle-claims', () => ({ getHandleClaimSigningRequest: mocks.claim }))
import { GET } from './route'

const review = (kind: string) => GET(new Request('https://libro.test'), { params: Promise.resolve({ kind, capability: 'capability' }) })

describe('Memorioso signing review', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.identity.mockResolvedValue('owner') })

  it('requires a browser session before reading a capability', async () => {
    mocks.identity.mockResolvedValue(null)
    expect((await review('sign')).status).toBe(401)
    expect(mocks.publication).not.toHaveBeenCalled()
  })

  it.each(['sign', 'sign-agent', 'claim'])('rejects a different identity for %s', async (kind) => {
    for (const load of [mocks.publication, mocks.agent, mocks.claim]) load.mockResolvedValue({ identity_id: 'another-person' })
    expect((await review(kind)).status).toBe(403)
  })

  it('returns the exact publication without session identifiers or prepared transactions', async () => {
    const publication = { publication_content: { html: '<p>Exact signed content</p>' } }
    mocks.publication.mockResolvedValue({ identity_id: 'owner', publication, signal_hash: 'signal', world_id_session_id: 'private', transaction: 'private' })
    const response = await review('sign')
    expect(await response.json()).toEqual({ publication, signalHash: 'signal' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
