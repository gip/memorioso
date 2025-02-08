import { NextResponse } from 'next/server'
// import { Post } from '@/types'
import { insecureGetSession } from '@/lib/insecure-api'
import { client } from '@/lib/db';

interface FormattedMessage {
    id: string;
    author: string;
    avatar?: string;
    community: string;
    content: string;
    comments: number;
    pay: string;
  }
  
async function getUnrepliedMessagesForWallet(
    walletAddress: string
  ): Promise<FormattedMessage[]> {
    try {
      const query = `
        WITH post_stats AS (
          SELECT 
            post_id,
            COUNT(*) as comment_count
          FROM actions
          WHERE decision IS NULL
          GROUP BY post_id
        )
        SELECT 
          p.uuid as id,
          c.author,
          c.title,
          p.content->>'text' as content,
          c.type as community,
          COALESCE(ps.comment_count, 0) as comments,
          CAST(p.amount AS DECIMAL(10,2)) as pay
        FROM actions a
        INNER JOIN humans h ON h.uuid = a.human_id
        INNER JOIN posts p ON p.uuid = a.post_id
        INNER JOIN campaigns c ON c.uuid = p.campaign_id
        LEFT JOIN post_stats ps ON ps.post_id = p.uuid
        WHERE h.wallet_address = $1
        AND a.decision IS NULL
        ORDER BY p.added_at ASC;
      `;
  
      const result = await client.query(query, [walletAddress]);
  
      return result.rows.map(row => ({
        id: row.id,
        author: row.author,
        title: row.title,
        community: row.community,
        content: row.content,
        comments: Number(row.comments),
        pay: Number(row.pay).toFixed(2)
      }));
    } catch (error) {
      console.error('Error fetching unreplied messages:', error);
      throw error;  // Throw the original error for better debugging
    }
  }

  async function createActionsForWallet(walletAddress: string): Promise<void> {
    if (!walletAddress) {
      throw new Error('walletAddress is required');
    }
  
    try {
      // Use a transaction to ensure consistency
      await client.query('BEGIN');
  
      // Get human's UUID from wallet address
      const humanCheck = await client.query(
        'SELECT uuid FROM humans WHERE wallet_address = $1',
        [walletAddress]
      );
  
      if (humanCheck.rows.length === 0) {
        throw new Error('Human not found for wallet address');
      }
  
      const humanId = humanCheck.rows[0].uuid;
  
      // Find eligible posts and create actions in one query
      const query = `
        WITH available_posts AS (
          SELECT p.uuid as post_id
          FROM posts p
          WHERE NOT EXISTS (
            SELECT 1 
            FROM actions a 
            WHERE a.post_id = p.uuid 
            AND a.human_id = $1::uuid
          )
          ORDER BY random()
          LIMIT 10
        )
        INSERT INTO actions (
          uuid,
          post_id,
          human_id,
          reply,
          replied_at,
          reviewed_at
        )
        SELECT 
          gen_random_uuid(),
          post_id,
          $1::uuid as human_id,
          '{"text": ""}' as reply,
          NULL as replied_at,
          NULL as reviewed_at
        FROM available_posts
        RETURNING uuid;
      `;
  
      const result = await client.query(query, [humanId]);
      await client.query('COMMIT');
  
      console.log(`Created ${result.rowCount} new actions for wallet ${walletAddress}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating actions:', error);
      throw error;
    }
  }

// const posts: Post[] = [
//   {
//     id: '533ebdcc-8425-4dda-b696-d0800c5e8e7c',
//     author: "Human Research Inc",
//     community: "AI",
//     title: "Building a San Francisco Dataset",
//     content:
//       "What neighborhoods have the highest concentration of fine dining restaurants?",
//     image: '',
//     comments: 42,
//     pay: '0.20'
//   },
//   {
//     id: '533ebdcc-8425-4dda-b696-d0800c5e8e7d',
//     author: "nftcollector",
//     avatar: "/placeholder.svg?height=40&width=40",
//     community: "San Francisco",
//     content:
//       "Just minted my latest NFT collection! It's a series of digital art pieces inspired by classic literature. Check it out on OpenSea! #NFT #DigitalArt",
//     comments: 23,
//     pay: '0.50'
//   },
//   {
//     id: '533ebdcc-8425-4dda-b696-d0800c5e8e8c',
//     author: "techanalyst",
//     avatar: null,
//     community: "tech",
//     content:
//       "New report suggests AI will create more jobs than it displaces in the next decade. Exciting times ahead for the tech industry! What skills do you think will be most valuable?",
//     comments: 67,
//     pay: '0.50'
//   },
//   {
//     id: '533ebdcc-8425-4dda-b696-d0800c5e8e9c',
//     author: "techanalyst",
//     avatar: "/placeholder.svg?height=40&width=40",
//     community: "tech",
//     content:
//       "New report suggests AI will create more jobs than it displaces in the next decade. Exciting times ahead for the tech industry! What skills do you think will be most valuable?",
//     comments: 67,
//     pay: '0.50'
//   },
//   {
//     id: '533ebdcc-8425-4dda-b696-d0800c5e8eac',
//     author: "techanalyst",
//     avatar: "/placeholder.svg?height=40&width=40",
//     community: "tech",
//     content:
//       "New report suggests AI will create more jobs than it displaces in the next decade. Exciting times ahead for the tech industry! What skills do you think will be most valuable?",
//     comments: 67,
//     pay: '0.50'
//   },
// ]

export const GET = async () => {
 const insecureSession = await insecureGetSession()
  if (!insecureSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('SSS', insecureSession)
  let unrepliedMessages = await getUnrepliedMessagesForWallet(insecureSession.address)
  if(unrepliedMessages.length === 0) {
    await createActionsForWallet(insecureSession.address)
    unrepliedMessages = await getUnrepliedMessagesForWallet(insecureSession.address)
  }

  console.log('MMM', unrepliedMessages)
  return NextResponse.json({ success: true, feed: unrepliedMessages })
}