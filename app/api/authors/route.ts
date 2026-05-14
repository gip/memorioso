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
    const authorsResult = await client.query(
      'SELECT * FROM authors WHERE "userId" = $1',
      [authenticatedUser.id]
    );

    const authors = authorsResult.rows;

    return NextResponse.json({ success: true, authors });
  } finally {
    client.release();
  }
}
