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
