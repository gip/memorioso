import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db' 
import { getAuthenticatedUser } from '@/lib/auth-user'
import { isPublicationKind } from '@/lib/publication-kind'
import { isPublicationAccess, validateAccessForKind } from '@/lib/access/draft-access'

export async function POST(req: NextRequest) {
  const authenticatedUser = await getAuthenticatedUser();

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  const { title, subtitle, content, history, authorId, publicationType, access } = await req.json();
  const normalizedAuthorId = authorId ?? null;

  if (normalizedAuthorId !== null && typeof normalizedAuthorId !== 'string') {
    return NextResponse.json({ success: false, message: "Author ID must be a string" }, { status: 400 });
  }

  const normalizedPublicationType = publicationType ?? 'article';
  if (!isPublicationKind(normalizedPublicationType)) {
    return NextResponse.json({ success: false, message: "Publication type must be short or article" }, { status: 400 });
  }

  const normalizedAccess = access ?? 'public';
  if (!isPublicationAccess(normalizedAccess)) {
    return NextResponse.json({ success: false, message: "Access must be public or gated" }, { status: 400 });
  }

  const accessError = validateAccessForKind(normalizedAccess, normalizedPublicationType);
  if (accessError) {
    return NextResponse.json({ success: false, message: accessError }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    if (normalizedAuthorId) {
      const authorResult = await client.query(
        'SELECT id FROM authors WHERE id::text = $1 AND "userId" = $2',
        [normalizedAuthorId, authenticatedUser.id]
      );
      if (authorResult.rows.length === 0) {
        return NextResponse.json({ success: false, message: "Author not found" }, { status: 400 });
      }
    }

    const history0 = history || { history: null };

    const draftResult = await client.query(
      `INSERT INTO drafts ("userId", status, publication_type, title, subtitle, content, history, "authorId", access)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *, publication_type AS "publicationType"`,
      [authenticatedUser.id, 'editing', normalizedPublicationType, title, subtitle, content, history0, normalizedAuthorId, normalizedAccess]
    );

    const draft = draftResult.rows[0];

    return NextResponse.json({ success: true, draft });
  } finally {
    client.release();
  }
}
