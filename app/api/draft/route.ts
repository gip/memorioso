import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db' 
import { getAuthenticatedUser } from '@/lib/auth-user'

export async function POST(req: NextRequest) {
  const authenticatedUser = await getAuthenticatedUser();

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  const { title, subtitle, content, history, authorId } = await req.json();

  const client = await pool.connect();

  try {
    const history0 = history || { history: null };

    const draftResult = await client.query(
      'INSERT INTO drafts ("userId", status, title, subtitle, content, history, "authorId") VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [authenticatedUser.id, 'editing', title, subtitle, content, history0, authorId]
    );

    const draft = draftResult.rows[0];

    return NextResponse.json({ success: true, draft });
  } finally {
    client.release();
  }
}
