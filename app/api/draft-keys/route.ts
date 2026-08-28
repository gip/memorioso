// Storage for the author's wrapped draft key, and for their choice not to have one.
//
// The server holds wrapped bytes, a salt and a KDF cost, and never learns the
// key itself: it cannot unwrap them, and there is nothing here it could do with
// them. What it does enforce is that an existing wrapper set is never replaced
// by accident, and that encryption is never switched off underneath drafts that
// are already sealed — either would strand every draft the key opens.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { MIN_PBKDF2_ITERATIONS } from '@/lib/draft-crypto'

const DRAFT_KEY_WRAPPERS = ['passphrase', 'recovery'] as const

type DraftKeyWrapperName = typeof DRAFT_KEY_WRAPPERS[number]

const SALT_BYTES = 16
// AES-GCM over a 32-byte data key: 12-byte iv, 32-byte ciphertext, 16-byte tag.
const WRAPPED_DEK_BYTES = 60
// A cost nobody should be able to talk a client into exceeding by accident.
const MAX_PBKDF2_ITERATIONS = 10_000_000

type WrapperInput = {
  wrapper: DraftKeyWrapperName
  kdfSalt: Buffer
  kdfIterations: number | null
  kekFingerprint: string
  wrappedDek: Buffer
}

const decodeBase64Url = (value: unknown, expectedBytes: number): Buffer | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  const decoded = Buffer.from(value, 'base64url')
  return decoded.length === expectedBytes ? decoded : null
}

/**
 * A passphrase wrapper is only as good as the work behind it, and the client
 * chooses that number, so the floor is enforced here rather than trusted.
 */
function parseIterations(
  wrapper: DraftKeyWrapperName,
  value: unknown
): { ok: true; iterations: number | null } | { ok: false; message: string } {
  if (wrapper !== 'passphrase') {
    return value === undefined || value === null
      ? { ok: true, iterations: null }
      : { ok: false, message: 'Only a passphrase wrapper carries a KDF cost' }
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false, message: 'A passphrase wrapper must carry its KDF cost' }
  }
  if (value < MIN_PBKDF2_ITERATIONS || value > MAX_PBKDF2_ITERATIONS) {
    return { ok: false, message: 'Passphrase KDF cost is out of range' }
  }
  return { ok: true, iterations: value }
}

function parseWrappers(value: unknown): { ok: true; wrappers: WrapperInput[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > DRAFT_KEY_WRAPPERS.length) {
    return { ok: false, message: 'One or two draft key wrappers are required' }
  }

  const wrappers: WrapperInput[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    const name = (entry as { wrapper?: unknown })?.wrapper
    if (typeof name !== 'string' || !DRAFT_KEY_WRAPPERS.includes(name as DraftKeyWrapperName)) {
      return { ok: false, message: 'Unknown draft key wrapper' }
    }
    if (seen.has(name)) {
      return { ok: false, message: 'Draft key wrappers must be distinct' }
    }
    seen.add(name)

    const kdfSalt = decodeBase64Url((entry as { kdfSalt?: unknown }).kdfSalt, SALT_BYTES)
    const wrappedDek = decodeBase64Url((entry as { wrappedDek?: unknown }).wrappedDek, WRAPPED_DEK_BYTES)
    const kekFingerprint = (entry as { kekFingerprint?: unknown }).kekFingerprint

    if (!kdfSalt || !wrappedDek) {
      return { ok: false, message: 'Draft key wrapper is malformed' }
    }
    if (typeof kekFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(kekFingerprint)) {
      return { ok: false, message: 'Draft key fingerprint is malformed' }
    }

    const iterations = parseIterations(
      name as DraftKeyWrapperName,
      (entry as { kdfIterations?: unknown }).kdfIterations
    )
    if (!iterations.ok) return iterations

    wrappers.push({
      wrapper: name as DraftKeyWrapperName,
      kdfSalt,
      kdfIterations: iterations.iterations,
      kekFingerprint,
      wrappedDek,
    })
  }

  return { ok: true, wrappers }
}

export async function GET(): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  const client = await pool.connect()
  try {
    const [choice, wrappers] = await Promise.all([
      client.query(`SELECT draft_encryption FROM users WHERE id = $1`, [authenticatedUser.id]),
      client.query(
        `SELECT wrapper, kdf_salt, kdf_iterations, kek_fingerprint, wrapped_dek
         FROM user_draft_key_wrappers
         WHERE "userId" = $1
         ORDER BY wrapper`,
        [authenticatedUser.id]
      ),
    ])

    return NextResponse.json({
      success: true,
      encryption: choice.rows[0]?.draft_encryption ?? null,
      wrappers: wrappers.rows.map((row) => ({
        wrapper: row.wrapper as DraftKeyWrapperName,
        kdfSalt: Buffer.from(row.kdf_salt).toString('base64url'),
        kdfIterations: row.kdf_iterations ?? null,
        kekFingerprint: row.kek_fingerprint,
        wrappedDek: Buffer.from(row.wrapped_dek).toString('base64url'),
      })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } finally {
    client.release()
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { wrappers?: unknown; encryption?: unknown } | null

  // Declining encryption is the one write that carries no key material.
  if (body?.encryption === 'none') {
    return declineEncryption(authenticatedUser.id)
  }
  if (body?.encryption !== undefined && body?.encryption !== 'passphrase') {
    return NextResponse.json({ success: false, message: 'Unknown draft encryption choice' }, { status: 400 })
  }

  const parsed = parseWrappers(body?.wrappers)
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existing = await client.query(
      `SELECT wrapper FROM user_draft_key_wrappers WHERE "userId" = $1 FOR UPDATE`,
      [authenticatedUser.id]
    )

    // The first write establishes the key, so it has to establish both ways in
    // at once: an author who ends up with only a 'passphrase' wrapper has no way
    // back if that passphrase is ever forgotten.
    if (existing.rows.length === 0 && parsed.wrappers.length !== DRAFT_KEY_WRAPPERS.length) {
      await client.query('ROLLBACK')
      return NextResponse.json({
        success: false,
        message: 'The first draft key must be stored with both wrappers',
      }, { status: 400 })
    }

    for (const wrapper of parsed.wrappers) {
      await client.query(
        `INSERT INTO user_draft_key_wrappers ("userId", wrapper, kdf_salt, kdf_iterations, kek_fingerprint, wrapped_dek)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("userId", wrapper) DO UPDATE
           SET kdf_salt = EXCLUDED.kdf_salt,
               kdf_iterations = EXCLUDED.kdf_iterations,
               kek_fingerprint = EXCLUDED.kek_fingerprint,
               wrapped_dek = EXCLUDED.wrapped_dek`,
        [
          authenticatedUser.id,
          wrapper.wrapper,
          wrapper.kdfSalt,
          wrapper.kdfIterations,
          wrapper.kekFingerprint,
          wrapper.wrappedDek,
        ]
      )
    }

    // Storing a key is the choice; an author who declined earlier and changed
    // their mind ends up here, and their plaintext drafts migrate on unlock.
    await client.query(
      `UPDATE users SET draft_encryption = 'passphrase', modified_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [authenticatedUser.id]
    )

    await client.query('COMMIT')
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({
      success: false,
      message: 'Failed to store the draft key',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  } finally {
    client.release()
  }
}

async function declineEncryption(userId: number): Promise<NextResponse> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existing = await client.query(
      `SELECT wrapper FROM user_draft_key_wrappers WHERE "userId" = $1 FOR UPDATE`,
      [userId]
    )

    // Refusing rather than deleting the wrappers: the drafts sealed under that
    // key would still be ciphertext, and dropping the only thing that opens them
    // is not a preference an author can express by accident.
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({
        success: false,
        message: 'These drafts are already encrypted, so encryption cannot be turned off',
      }, { status: 409 })
    }

    await client.query(
      `UPDATE users SET draft_encryption = 'none', modified_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [userId]
    )

    await client.query('COMMIT')
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({
      success: false,
      message: 'Failed to save that choice',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
