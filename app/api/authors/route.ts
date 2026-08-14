import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db' 
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getOwnedAuthors } from '@/lib/authors'

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
  void req
  return NextResponse.json({
    success: false,
    message: 'Each login has one handle. Create another login to use another handle.',
  }, { status: 405 })
}
