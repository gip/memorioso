import { afterEach, describe, expect, it, vi } from 'vitest'
import { enqueueServiceEvent } from './events'
import type { DatabaseClient } from './db'

afterEach(() => vi.unstubAllEnvs())
describe('revision event destinations', () => {
  it('delivers to the publishing client and participating family clients, excluding unrelated clients', async () => {
    vi.stubEnv('LIBRO_WEBHOOK_DESTINATIONS', JSON.stringify(['publisher', 'participant', 'unrelated'].map(clientId => ({ clientId, url: `https://${clientId}.example/events`, secret: 'a'.repeat(32) }))))
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'event-1' }] })
    await enqueueServiceEvent({ query } as unknown as DatabaseClient, { type: 'publication.finalized', originClientId: 'publisher', additionalClientIds: ['participant'], aggregateId: '11', data: {} })
    const urls = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO libro_event_deliveries')).map(([, args]) => args[1])
    expect(urls).toEqual(['https://publisher.example/events', 'https://participant.example/events'])
  })
})
