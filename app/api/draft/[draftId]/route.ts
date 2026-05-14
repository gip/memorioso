import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db' 
import { getAuthenticatedUser } from '@/lib/auth-user'

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
      `SELECT d.*, a.name as author_name 
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
  const { id, status, title, subtitle, content, history, authorId } = await req.json();

  if (draftId !== id) {
    return NextResponse.json({ success: false, message: "Draft ID mismatch" }, { status: 400 });
  }

  if (!id) {
    return NextResponse.json({ success: false, message: "Draft ID is required" }, { status: 400 });
  }

  if (status !== 'editing') {
    return NextResponse.json({ success: false, message: "Only drafts with status 'editing' can be modified" }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    const draftResult = await client.query(
      `UPDATE drafts 
       SET status = $1, title = $2, subtitle = $3, content = $4, history = $5, "authorId" = $6 
       WHERE id = $7 AND "userId" = $8 AND status = $9 
       RETURNING *`,
      [status, title, subtitle, content, history, authorId, id, authenticatedUser.id, 'editing']
    );

    if (draftResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: "Draft not found or you do not have permission to update this draft" }, { status: 404 });
    }

    const draft = draftResult.rows[0];

    return NextResponse.json({ success: true, draft });
  } finally {
    client.release();
  }
}
