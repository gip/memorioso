import { NextResponse } from 'next/server'
import { client } from '@/lib/db'
import { insecureGetSession } from '@/lib/insecure-api';

type ActionStatus = 'pending_reply' | 'pending_decision' | 'pending_payment' | 'completed'

interface PostWithState {
  id: string;
  author: string;
  avatar: string;
  community: string;
  content: string;
  comments: number;
  pay: string;
  state: ActionStatus;
  reply?: string;
  replyDate?: Date;
  reviewDate?: Date;
  decisionDate?: Date;
  decision?: string;
}

async function getPostsByState(
  walletAddress: string, 
  state: ActionStatus
): Promise<PostWithState[]> {
  
  try {
    const query = `
      WITH post_stats AS (
        SELECT 
          post_id,
          COUNT(*) as comment_count
        FROM actions
        WHERE replied_at IS NOT NULL
        GROUP BY post_id
      )
      SELECT 
        p.uuid as id,
        c.author,
        p.content->>'text' as content,
        c.type as community,
        COALESCE(ps.comment_count, 0) as comments,
        CAST(p.amount AS DECIMAL(10,2)) as pay,
        a.reply->>'text' as reply,
        a.replied_at as "replyDate",
        a.reviewed_at as "reviewDate",
        a.decided_at as "decisionDate",
        a.decision,
        a.status as state
      FROM actions a
      INNER JOIN humans h ON h.uuid = a.human_id
      INNER JOIN posts p ON p.uuid = a.post_id
      INNER JOIN campaigns c ON c.uuid = p.campaign_id
      LEFT JOIN post_stats ps ON ps.post_id = p.uuid
      WHERE h.wallet_address = $1
      AND a.status = $2
      ORDER BY p.added_at DESC;
    `;

    const result = await client.query(query, [walletAddress, state]);

    return result.rows.map(row => ({
      id: row.id,
      author: row.author,
      avatar: "/placeholder.svg?height=40&width=40",
      community: row.community,
      content: row.content,
      comments: Number(row.comments),
      pay: Number(row.pay).toFixed(2),
      state: row.state,
      reply: row.reply,
      replyDate: row.replyDate,
      reviewDate: row.reviewDate,
      decisionDate: row.decisionDate,
      decision: row.decision
    }));

  } catch (error) {
    console.error('Error fetching posts by state:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function GET() {
  const session = await insecureGetSession()
  if (!session) {
    return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 })
  }
  
  const address = session.address   
  const posts = await getPostsByState(address, 'pending_payment')
  console.log('POS', posts)
  return NextResponse.json({ status: 'success', posts })
}
