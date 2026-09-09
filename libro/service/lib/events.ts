import { createHmac } from 'node:crypto'
import type { DatabaseClient } from './db'
import { pool } from './db'
import { ServiceError } from './errors'

type Destination = { clientId: string; url: string; secret: string }

function destinations(): Destination[] {
  const raw = process.env.LIBRO_WEBHOOK_DESTINATIONS
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('LIBRO_WEBHOOK_DESTINATIONS must be valid JSON')
  }
  if (!Array.isArray(value)) throw new Error('LIBRO_WEBHOOK_DESTINATIONS must be an array')
  return value.map((item) => {
    const candidate = item as Partial<Destination>
    if (!candidate.clientId || !candidate.url || !candidate.secret || Buffer.byteLength(candidate.secret) < 32) {
      throw new Error('Every webhook destination requires clientId, url, and a 32-byte secret')
    }
    const url = new URL(candidate.url)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('Webhook URLs must use HTTPS')
    return { clientId: candidate.clientId, url: url.toString(), secret: candidate.secret }
  })
}

export async function enqueueServiceEvent(
  client: DatabaseClient,
  event: { type: 'publication.finalized' | 'author.updated'; originClientId?: string | null; aggregateId: string; data: object },
): Promise<string> {
  const inserted = await client.query(
    `INSERT INTO libro_service_events (event_type, origin_client_id, aggregate_id, payload)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [event.type, event.originClientId || null, event.aggregateId, event.data],
  )
  const eventId = inserted.rows[0].id as string
  const matching = destinations().filter((destination) =>
    event.type === 'author.updated' || destination.clientId === event.originClientId
  )
  for (const destination of matching) {
    await client.query(
      `INSERT INTO libro_event_deliveries (event_id, destination) VALUES ($1, $2)
       ON CONFLICT (event_id, destination) DO NOTHING`,
      [eventId, destination.url],
    )
  }
  return eventId
}

function signature(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

export async function deliverPendingEvents(limit = 25): Promise<{ attempted: number; delivered: number }> {
  const configured = new Map(destinations().map((item) => [item.url, item]))
  const claimed = await pool.query(
    `UPDATE libro_event_deliveries d
     SET attempts = attempts + 1,
       next_attempt_at = CURRENT_TIMESTAMP + (LEAST(3600, POWER(2, LEAST(attempts, 11))) * INTERVAL '1 second')
     FROM (
       SELECT event_id, destination FROM libro_event_deliveries
       WHERE delivered_at IS NULL AND next_attempt_at <= CURRENT_TIMESTAMP
       ORDER BY next_attempt_at ASC LIMIT $1
       FOR UPDATE SKIP LOCKED
     ) pending
     WHERE d.event_id = pending.event_id AND d.destination = pending.destination
     RETURNING d.event_id, d.destination`,
    [limit],
  )
  let delivered = 0
  for (const delivery of claimed.rows) {
    const destination = configured.get(delivery.destination)
    if (!destination) {
      await pool.query(
        `UPDATE libro_event_deliveries SET last_error = 'Destination is no longer configured'
         WHERE event_id = $1 AND destination = $2`,
        [delivery.event_id, delivery.destination],
      )
      continue
    }
    const eventResult = await pool.query('SELECT * FROM libro_service_events WHERE id = $1', [delivery.event_id])
    const event = eventResult.rows[0]
    if (!event) continue
    const body = JSON.stringify({
      id: event.id,
      type: event.event_type,
      occurredAt: new Date(event.occurred_at).toISOString(),
      originClientId: event.origin_client_id,
      aggregateId: event.aggregate_id,
      data: event.payload,
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    try {
      const response = await fetch(destination.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Libro-Event-Id': event.id,
          'X-Libro-Timestamp': timestamp,
          'X-Libro-Signature': signature(destination.secret, timestamp, body),
        },
        body,
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await pool.query(
        `UPDATE libro_event_deliveries SET delivered_at = CURRENT_TIMESTAMP, last_error = NULL
         WHERE event_id = $1 AND destination = $2`,
        [event.id, destination.url],
      )
      delivered += 1
    } catch (error) {
      await pool.query(
        `UPDATE libro_event_deliveries SET last_error = $3
         WHERE event_id = $1 AND destination = $2`,
        [event.id, destination.url, error instanceof Error ? error.message.slice(0, 1000) : 'Delivery failed'],
      )
    }
  }
  return { attempted: claimed.rowCount || 0, delivered }
}

export function assertInternalDeliveryRequest(request: Request): void {
  const expected = process.env.LIBRO_INTERNAL_CRON_SECRET
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!expected || actual !== expected) throw new ServiceError('AUTH_REQUIRED', 'Internal delivery authorization failed', 401)
}
