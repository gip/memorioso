import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db' 
import { getAuthenticatedUser } from '@/lib/auth-user'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser();

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  const client = await pool.connect();

  try {
    const draftsResult = await client.query(
      `SELECT d.*, d.publication_type AS "publicationType", a.name as author_name
       FROM drafts d 
       LEFT JOIN authors a ON d."authorId" = a.id 
       WHERE d."userId" = $1 AND d.status = $2
       ORDER BY d.created_at DESC`,
      [authenticatedUser.id, 'editing']
    );

    const drafts = draftsResult.rows;

    return NextResponse.json({ success: true, drafts });
  } finally {
    client.release();
  }
}
