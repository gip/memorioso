import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db' 
import { getAuthenticatedUser } from '@/lib/auth-user'
import { isPublicationKind } from '@/lib/publication-kind'

export async function POST(req: NextRequest) {
  const authenticatedUser = await getAuthenticatedUser();

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  const { title, subtitle, content, history, authorId, publicationType } = await req.json();

  const normalizedPublicationType = publicationType ?? 'article';
  if (!isPublicationKind(normalizedPublicationType)) {
    return NextResponse.json({ success: false, message: "Publication type must be short or article" }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    const history0 = history || { history: null };

    const draftResult = await client.query(
      `INSERT INTO drafts ("userId", status, publication_type, title, subtitle, content, history, "authorId")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *, publication_type AS "publicationType"`,
      [authenticatedUser.id, 'editing', normalizedPublicationType, title, subtitle, content, history0, authorId]
    );

    const draft = draftResult.rows[0];

    return NextResponse.json({ success: true, draft });
  } finally {
    client.release();
  }
}
