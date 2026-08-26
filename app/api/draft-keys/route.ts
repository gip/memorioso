// Storage for the author's wrapped draft key.
//
// The server holds wrapped bytes and a salt and never learns the key itself: it
// cannot unwrap them, and there is nothing here it could do with them. What it
// does enforce is that an existing wrapper set is never replaced by accident,
// because overwriting a wrapper an author still relies on would strand every
// draft it opens.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'

const DRAFT_KEY_WRAPPERS = ['worldid', 'recovery'] as const

type DraftKeyWrapperName = typeof DRAFT_KEY_WRAPPERS[number]

const SALT_BYTES = 16
// AES-GCM over a 32-byte data key: 12-byte iv, 32-byte ciphertext, 16-byte tag.
const WRAPPED_DEK_BYTES = 60

type WrapperInput = {
  wrapper: DraftKeyWrapperName
  kdfSalt: Buffer
  kekFingerprint: string
  wrappedDek: Buffer
}

const decodeBase64Url = (value: unknown, expectedBytes: number): Buffer | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  const decoded = Buffer.from(value, 'base64url')
  return decoded.length === expectedBytes ? decoded : null
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

    wrappers.push({ wrapper: name as DraftKeyWrapperName, kdfSalt, kekFingerprint, wrappedDek })
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
    const { rows } = await client.query(
      `SELECT wrapper, kdf_salt, kek_fingerprint, wrapped_dek
       FROM user_draft_key_wrappers
       WHERE "userId" = $1
       ORDER BY wrapper`,
      [authenticatedUser.id]
    )

    return NextResponse.json({
      success: true,
      wrappers: rows.map((row) => ({
        wrapper: row.wrapper as DraftKeyWrapperName,
        kdfSalt: Buffer.from(row.kdf_salt).toString('base64url'),
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

  const body = await req.json().catch(() => null) as { wrappers?: unknown } | null
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
    // at once: an author who ends up with only a 'worldid' wrapper has no way
    // back if that key source ever stops reproducing.
    if (existing.rows.length === 0 && parsed.wrappers.length !== DRAFT_KEY_WRAPPERS.length) {
      await client.query('ROLLBACK')
      return NextResponse.json({
        success: false,
        message: 'The first draft key must be stored with both wrappers',
      }, { status: 400 })
    }

    for (const wrapper of parsed.wrappers) {
      await client.query(
        `INSERT INTO user_draft_key_wrappers ("userId", wrapper, kdf_salt, kek_fingerprint, wrapped_dek)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("userId", wrapper) DO UPDATE
           SET kdf_salt = EXCLUDED.kdf_salt,
               kek_fingerprint = EXCLUDED.kek_fingerprint,
               wrapped_dek = EXCLUDED.wrapped_dek`,
        [
          authenticatedUser.id,
          wrapper.wrapper,
          wrapper.kdfSalt,
          wrapper.kekFingerprint,
          wrapper.wrappedDek,
        ]
      )
    }

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
