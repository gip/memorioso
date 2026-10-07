import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/db', () => ({ pool: { connect: async () => ({ query: mocks.query, release: mocks.release }) } }))
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidate }))
import { POST } from './route'

const author = 'a0000000-0000-0000-0000-000000000001'
const hash = `0x${'ab'.repeat(32)}`
const eventId = 'b0000000-0000-0000-0000-000000000001'
const secret = 'test-webhook-secret-with-at-least-32-bytes'
const previous = { publication_id: '10', root_publication_id: '10', authorId: author, revision_number: 1, access: 'gated', access_price_usd: '0.05' }
function event(overrides: Record<string, unknown> = {}) {
  return { id: eventId, type: 'publication.finalized', occurredAt: new Date().toISOString(), originClientId: 'other-client', aggregateId: '11', data: {
    publicationId: '11', authorId: author, signalHash: hash, authorshipClass: 'human',
    revision: { rootPublicationId: '10', previousPublicationId: '10', initiallyPublishedAt: '2026-09-01T00:00:00Z', revisionNumber: 2 }, ...overrides,
  } }
}
function request(body: ReturnType<typeof event>) {
  const text = JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  return new Request('https://memorioso.xyz/api/libro/events', { method: 'POST', body: text, headers: {
    'x-libro-timestamp': timestamp, 'x-libro-event-id': body.id,
    'x-libro-signature': `v1=${createHmac('sha256', secret).update(`${timestamp}.${text}`).digest('hex')}`,
  } })
}
function database(options: { duplicate?: boolean; previous?: object | null; knownFamily?: boolean; pending?: object } = {}) {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO processed_libro_events')) return { rows: options.duplicate ? [] : [{ event_id: eventId }] }
    if (sql.includes('SELECT * FROM pending_libro_publications')) return { rows: options.pending ? [options.pending] : [] }
    if (sql.includes('SELECT * FROM publication_policies')) return { rows: options.previous === null ? [] : [options.previous || previous] }
    if (sql.includes('SELECT 1 FROM publication_policies')) return { rows: options.knownFamily ? [{}] : [] }
    if (sql.includes('SELECT publication_id::text')) return { rows: [{ id: '10' }, { id: '11' }, { id: '12' }] }
    return { rows: [] }
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('LIBRO_WEBHOOK_SECRET', secret)
  vi.stubEnv('LIBRO_OAUTH_CLIENT_ID', 'memorioso')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('revision event projection', () => {
  it('accepts an update from another client only for an existing local family and inherits its policy', async () => {
    database()
    const response = await POST(request(event()))
    expect(response.status).toBe(200)
    const policy = mocks.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO publication_policies'))!
    expect(policy[1]).toEqual(['11', hash, author, 'other-client', 'gated', '0.05'])
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
    expect(mocks.revalidate).toHaveBeenCalledWith('publication:12', { expire: 0 })
  })
  it('acknowledges unrelated families without adding them to the local feed', async () => {
    database({ previous: null })
    expect(await (await POST(request(event()))).json()).toMatchObject({ ignored: true })
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO publication_policies'))).toBe(false)
  })
  it('rolls back the event acknowledgement when a known family arrives out of order so delivery can retry', async () => {
    database({ previous: null, knownFamily: true })
    expect((await POST(request(event()))).status).toBe(409)
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.query).not.toHaveBeenCalledWith('COMMIT')
  })
  it('deduplicates before mutating family state', async () => {
    database({ duplicate: true })
    expect(await (await POST(request(event()))).json()).toMatchObject({ duplicate: true })
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO publication_policies'))).toBe(false)
  })
  it('projects a delayed older version without changing the current family head', async () => {
    database()
    expect((await POST(request(event()))).status).toBe(200)
    const writes = mocks.query.mock.calls.filter(([sql]) => /^(UPDATE|INSERT)/.test(sql))
    expect(writes.filter(([sql]) => sql.startsWith('UPDATE publication_policies'))).toHaveLength(1)
    expect(writes.find(([sql]) => sql.startsWith('UPDATE publication_policies'))![1][0]).toBe('11')
    expect(writes.some(([sql]) => /SET.*head|SET.*is_latest/.test(sql))).toBe(false)
  })
  it('rejects a mismatched pending draft owner before acknowledging or publishing the draft', async () => {
    database({ pending: { authorId: 'another-author', signal_hash: hash, previous_publication_id: '10' } })
    const body = event({ clientReference: 'draft-1' }); body.originClientId = 'memorioso'
    expect((await POST(request(body))).status).toBe(409)
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("UPDATE drafts SET status = 'published'"))).toBe(false)
  })
})
