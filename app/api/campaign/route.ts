import { NextResponse } from 'next/server';
import { client } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';

export interface Campaign {
  id: string;
  title: string;
  type: string;
  description: string;
  author: string;
  tags: string[];
  startAt: string;
  endAt: string;
  createdAt: string;
}

export async function GET() {
  try {
    // Get the authenticated session
    const session = await getServerSession(authOptions)
    
    if (!session) {
        return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 })
    }

    // @ts-expect-error - user.id is not typed
    const userId = session.user?.id

    const query = `
      SELECT 
        uuid as id,
        title,
        type,
        description,
        author,
        tags,
        start_at as "startAt",
        end_at as "endAt",
        created_at as "createdAt"
      FROM campaigns
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;

    const result = await client.query(query, [userId]);

    const campaigns: Campaign[] = result.rows.map(row => ({
      ...row,
      tags: row.tags || [],  // Ensure tags is always an array
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      createdAt: row.createdAt.toISOString()
    }));

    console.log('CAM', campaigns)
    return NextResponse.json(campaigns);

  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
