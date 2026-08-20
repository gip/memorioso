// Persistence for proposed changes. See OPENSHIP-CHANGES.md for what a change is and
// lib/openship/validate.ts for what makes one acceptable.

import { pool } from '@/lib/db'
import type { OpenshipChangeRecord, OpenshipChangeStatus } from '@/lib/openship/change'

type Row = {
  id: string
  build_id: string
  base_digest: string
  result_digest: string
  title: string
  intent: string
  files_changed: number
  bytes: number
  status: OpenshipChangeStatus
  reason: string | null
  url: string | null
  submitted_at: Date
  modified_at: Date
}

const toRecord = (row: Row): OpenshipChangeRecord => ({
  changeId: row.id,
  buildId: row.build_id,
  base: row.base_digest,
  digest: row.result_digest,
  title: row.title,
  intent: row.intent,
  status: row.status,
  reason: row.reason,
  url: row.url,
  filesChanged: row.files_changed,
  bytes: row.bytes,
  submittedAt: row.submitted_at.toISOString(),
  updatedAt: row.modified_at.toISOString(),
})

const SELECT = `
    SELECT id, build_id, base_digest, result_digest, title, intent, files_changed, bytes,
           status, reason, url, submitted_at, modified_at
      FROM openship_changes
`

export type InsertChange = {
  buildId: string
  baseDigest: string
  resultDigest: string
  title: string
  intent: string
  /** The submitted patch, verbatim. `null` values are deletions. */
  patch: Record<string, { encoding: string; content: string } | null>
  filesChanged: number
  bytes: number
  submitter: string | null
}

/**
 * Inserts a change, or returns the existing record when the resulting tree is one already
 * submitted. The buildId is the digest of that tree, so an identical resubmission necessarily
 * deploys to the same origin; queueing a second build for it would be paying twice for one answer.
 */
export const insertOpenshipChange = async (
  input: InsertChange
): Promise<{ record: OpenshipChangeRecord; created: boolean }> => {
  const client = await pool.connect()
  try {
    const inserted = await client.query<Row>(
      `INSERT INTO openship_changes
           (build_id, base_digest, result_digest, title, intent, patch, files_changed, bytes, submitter)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       ON CONFLICT (result_digest) DO NOTHING
       RETURNING id, build_id, base_digest, result_digest, title, intent, files_changed, bytes,
                 status, reason, url, submitted_at, modified_at`,
      [
        input.buildId,
        input.baseDigest,
        input.resultDigest,
        input.title,
        input.intent,
        JSON.stringify(input.patch),
        input.filesChanged,
        input.bytes,
        input.submitter,
      ]
    )

    if (inserted.rows.length > 0) {
      return { record: toRecord(inserted.rows[0]), created: true }
    }

    const existing = await client.query<Row>(`${SELECT} WHERE result_digest = $1`, [
      input.resultDigest,
    ])
    return { record: toRecord(existing.rows[0]), created: false }
  } finally {
    client.release()
  }
}

export const getOpenshipChange = async (changeId: string): Promise<OpenshipChangeRecord | null> => {
  const client = await pool.connect()
  try {
    const result = await client.query<Row>(`${SELECT} WHERE id = $1`, [changeId])
    return result.rows[0] ? toRecord(result.rows[0]) : null
  } finally {
    client.release()
  }
}

export const getOpenshipChangeByBuildId = async (
  buildId: string
): Promise<OpenshipChangeRecord | null> => {
  const client = await pool.connect()
  try {
    const result = await client.query<Row>(`${SELECT} WHERE build_id = $1`, [buildId])
    return result.rows[0] ? toRecord(result.rows[0]) : null
  } finally {
    client.release()
  }
}

export type ClaimedChange = OpenshipChangeRecord & {
  patch: Record<string, { encoding: string; content: string } | null>
}

/**
 * Claims the oldest queued change for the build host. `FOR UPDATE SKIP LOCKED` lets more than one
 * worker run without coordinating, and `staleMinutes` reclaims rows whose worker died mid-build.
 */
export const claimOpenshipChange = async (staleMinutes = 30): Promise<ClaimedChange | null> => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const claimed = await client.query<Row & { patch: ClaimedChange['patch'] }>(
      `UPDATE openship_changes
          SET status = 'building', claimed_at = NOW()
        WHERE id = (
              SELECT id
                FROM openship_changes
               WHERE status = 'queued'
                  OR (status IN ('building', 'reviewing')
                      AND claimed_at < NOW() - ($1 || ' minutes')::interval)
            ORDER BY submitted_at
                 FOR UPDATE SKIP LOCKED
               LIMIT 1
            )
    RETURNING id, build_id, base_digest, result_digest, title, intent, patch, files_changed, bytes,
              status, reason, url, submitted_at, modified_at`,
      [String(staleMinutes)]
    )
    await client.query('COMMIT')

    const row = claimed.rows[0]
    return row ? { ...toRecord(row), patch: row.patch } : null
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const updateOpenshipChangeStatus = async (
  changeId: string,
  status: OpenshipChangeStatus,
  { reason, url }: { reason?: string | null; url?: string | null } = {}
): Promise<void> => {
  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE openship_changes
          SET status = $2,
              reason = COALESCE($3, reason),
              url = COALESCE($4, url)
        WHERE id = $1`,
      [changeId, status, reason ?? null, url ?? null]
    )
  } finally {
    client.release()
  }
}
