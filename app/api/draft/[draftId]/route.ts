import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db' 
import { getAuthenticatedUser } from '@/lib/auth-user'
import { isPublicationAccess, validateAccessForKind } from '@/lib/access/draft-access'
import { draftStorageColumns, parseDraftStorageFields } from '@/lib/draft-storage'

export async function GET(req: NextRequest, context: { params: Promise<{ draftId: string }> }): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser();

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  const { draftId } = await context.params;

  if (!draftId) {
    return NextResponse.json({ success: false, message: "Draft ID is required" }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    const draftResult = await client.query(
      `SELECT d.*, d.publication_type AS "publicationType", a.name as author_name
       FROM drafts d 
       LEFT JOIN authors a ON d."authorId" = a.id 
       WHERE d."userId" = $1 AND d.id = $2 AND d.status = $3`,
      [authenticatedUser.id, draftId, 'editing']
    );

    if (draftResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: "Draft not found or not in editing status" }, { status: 404 });
    }

    const draft = draftResult.rows[0];

    return NextResponse.json({ success: true, data: draft });
  } finally {
    client.release();
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ draftId: string }> }) {
  const authenticatedUser = await getAuthenticatedUser();

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
  }

  const { draftId } = await context.params;
  const body = await req.json();
  const { id, history, authorId, access } = body;
  const normalizedAuthorId = authorId ?? null;

  if (draftId !== id) {
    return NextResponse.json({ success: false, message: "Draft ID mismatch" }, { status: 400 });
  }

  if (!id) {
    return NextResponse.json({ success: false, message: "Draft ID is required" }, { status: 400 });
  }

  if (normalizedAuthorId !== null && typeof normalizedAuthorId !== 'string') {
    return NextResponse.json({ success: false, message: "Author ID must be a string" }, { status: 400 });
  }

  if (access !== undefined && !isPublicationAccess(access)) {
    return NextResponse.json({ success: false, message: "Access must be public or gated" }, { status: 400 });
  }

  const storage = parseDraftStorageFields(body);
  if (!storage.ok) {
    return NextResponse.json({ success: false, message: storage.message }, { status: 400 });
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

    if (access !== undefined) {
      // publication_type is a column on every draft, so the kind is read rather
      // than inferred: an encrypted draft has no title left to infer it from.
      const kindResult = await client.query(
        'SELECT publication_type FROM drafts WHERE id = $1 AND "userId" = $2',
        [id, authenticatedUser.id]
      );
      if (kindResult.rows.length === 0) {
        return NextResponse.json({ success: false, message: "Draft not found or you do not have permission to update this draft" }, { status: 404 });
      }
      const accessError = validateAccessForKind(access, kindResult.rows[0].publication_type);
      if (accessError) {
        return NextResponse.json({ success: false, message: accessError }, { status: 400 });
      }
    }

    const historyValue = history ?? { history: null };
    const columns = draftStorageColumns(storage.fields);

    const draftResult = await client.query(
      `UPDATE drafts
       SET title = $1, subtitle = $2, content = $3, ciphertext = $4, encryption = $5,
           history = $6, "authorId" = $7, access = COALESCE($11, access)
       WHERE id = $8 AND "userId" = $9 AND status = $10
       RETURNING *, publication_type AS "publicationType"`,
      [
        columns.title,
        columns.subtitle,
        columns.content,
        columns.ciphertext,
        columns.encryption,
        historyValue,
        normalizedAuthorId,
        id,
        authenticatedUser.id,
        'editing',
        access ?? null,
      ]
    );

    if (draftResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: "Draft not found or you do not have permission to update this draft" }, { status: 404 });
    }

    const draft = draftResult.rows[0];

    return NextResponse.json({ success: true, draft });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: "Failed to update draft",
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ draftId: string }> }
): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser(req)
  if (!authenticatedUser) {
    return NextResponse.json(
      { success: false, message: 'Authentication required' },
      { status: 401 }
    )
  }

  const { draftId } = await context.params
  if (!draftId) {
    return NextResponse.json(
      { success: false, message: 'Draft ID is required' },
      { status: 400 }
    )
  }

  const client = await pool.connect()
  try {
    const result = await client.query(
      `DELETE FROM drafts
       WHERE id = $1 AND "userId" = $2 AND status = $3
       RETURNING id`,
      [draftId, authenticatedUser.id, 'editing']
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Draft not found or you do not have permission to delete it' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, draftId })
  } finally {
    client.release()
  }
}
