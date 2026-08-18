import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'

export async function GET(req: NextRequest, context: { params: Promise<{ authorId: string }> }): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser();
  const { authorId } = await context.params;

  if (!authorId) {
    return NextResponse.json({ success: false, message: "Author ID is required" }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    const authorResult = await client.query(
      'SELECT name, bio, "userId" FROM authors WHERE id = $1',
      [authorId]
    );

    if (authorResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: "Author not found" }, { status: 404 });
    }

    const author = authorResult.rows[0];
    let self = false;
    if (authenticatedUser) {
      self = authenticatedUser?.id === author.userId;
    }

    return NextResponse.json({ success: true, author, self });
  } finally {
    client.release();
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ authorId: string }> }): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser();
  const { authorId } = await context.params;

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { name?: unknown, bio?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : null;
  const bio = typeof body?.bio === 'string' ? body.bio.trim() : null;

  if (name === null || name.length < 3 || name.length > 100) {
    return NextResponse.json({ success: false, message: "Name must be 3-100 characters" }, { status: 400 });
  }

  if (bio !== null && bio.length > 2000) {
    return NextResponse.json({ success: false, message: "Bio must be at most 2000 characters" }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `UPDATE authors SET name = $1, bio = $2, modified_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND "userId" = $4
       RETURNING id, name, bio, handle`,
      [name, bio, authorId, authenticatedUser.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Author not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, author: rows[0] });
  } finally {
    client.release();
  }
}
