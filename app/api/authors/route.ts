import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db' 
import { getAuthenticatedUser } from '@/lib/auth-user'
import {
  AuthorProfileValidationError,
  getOwnedAuthors,
  isAuthorHandleConflict,
  isAuthorLimitViolation,
  MAX_AUTHORS_PER_USER,
  normalizeAuthorProfile,
} from '@/lib/authors'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser();

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  const client = await pool.connect();

  try {
    const authors = await getOwnedAuthors(client, authenticatedUser.id);

    return NextResponse.json({ success: true, authors });
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser();
  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  let profile;
  try {
    profile = normalizeAuthorProfile(await req.json().catch(() => null));
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof AuthorProfileValidationError ? error.message : "Invalid author profile",
    }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
      [authenticatedUser.id]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, message: "Account not found" }, { status: 404 });
    }

    const countResult = await client.query(
      'SELECT COUNT(*)::int AS count FROM authors WHERE "userId" = $1',
      [authenticatedUser.id]
    );
    if (countResult.rows[0].count >= MAX_AUTHORS_PER_USER) {
      await client.query('ROLLBACK');
      return NextResponse.json({
        success: false,
        message: `An account can have at most ${MAX_AUTHORS_PER_USER} authors`,
      }, { status: 409 });
    }

    const { rows } = await client.query(
      `INSERT INTO authors ("userId", name, handle, bio)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, handle, bio, false AS "isPrimary"`,
      [authenticatedUser.id, profile.name, profile.handle, profile.bio]
    );
    await client.query('COMMIT');
    return NextResponse.json({ success: true, author: rows[0] }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK');
    if (isAuthorLimitViolation(error)) {
      return NextResponse.json({
        success: false,
        message: `An account can have at most ${MAX_AUTHORS_PER_USER} authors`,
      }, { status: 409 });
    }
    if (isAuthorHandleConflict(error)) {
      return NextResponse.json({ success: false, message: "That handle is already taken" }, { status: 409 });
    }
    return NextResponse.json({ success: false, message: "Failed to create author" }, { status: 500 });
  } finally {
    client.release();
  }
}
