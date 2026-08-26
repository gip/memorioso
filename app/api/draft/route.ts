import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db' 
import { getAuthenticatedUser } from '@/lib/auth-user'
import { isPublicationKind } from '@/lib/publication-kind'
import { isPublicationAccess, validateAccessForKind } from '@/lib/access/draft-access'
import { draftStorageColumns, isDraftId, parseDraftStorageFields } from '@/lib/draft-storage'

export async function POST(req: NextRequest) {
  const authenticatedUser = await getAuthenticatedUser();

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  const body = await req.json();
  const { history, authorId, publicationType, access, id } = body;
  const normalizedAuthorId = authorId ?? null;

  if (normalizedAuthorId !== null && typeof normalizedAuthorId !== 'string') {
    return NextResponse.json({ success: false, message: "Author ID must be a string" }, { status: 400 });
  }

  const storage = parseDraftStorageFields(body);
  if (!storage.ok) {
    return NextResponse.json({ success: false, message: storage.message }, { status: 400 });
  }

  // An encrypted draft is sealed against its own id, so the client picks the id
  // rather than encrypting a second time once the server has assigned one.
  if (id !== undefined && id !== null && !isDraftId(id)) {
    return NextResponse.json({ success: false, message: "Draft ID must be a UUID" }, { status: 400 });
  }
  if (storage.fields.encryption === 'v1' && !isDraftId(id)) {
    return NextResponse.json({ success: false, message: "Encrypted drafts require a client-generated draft ID" }, { status: 400 });
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
    const columns = draftStorageColumns(storage.fields);

    const draftResult = await client.query(
      `INSERT INTO drafts (id, "userId", status, publication_type, title, subtitle, content, ciphertext, encryption, history, "authorId", access)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *, publication_type AS "publicationType"`,
      [
        id ?? null,
        authenticatedUser.id,
        'editing',
        normalizedPublicationType,
        columns.title,
        columns.subtitle,
        columns.content,
        columns.ciphertext,
        columns.encryption,
        history0,
        normalizedAuthorId,
        normalizedAccess,
      ]
    );

    const draft = draftResult.rows[0];

    return NextResponse.json({ success: true, draft });
  } finally {
    client.release();
  }
}
