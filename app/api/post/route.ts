import { insecureGetSession } from "@/lib/insecure-api"
import { NextResponse } from "next/server"
import { client } from "@/lib/db"
import { anthropicClient } from "@/lib/anthropic"

interface PostActionDetails {
  // Post details
  postId: string;
  postType: string;
  postContent: unknown;
  postAddedAt: Date;
  postAmount: number;
  
  // Action details
  actionId: string;
  reply: unknown;
  repliedAt: Date | null;
  reviewedAt: Date | null;
  decidedAt: Date | null;
  decision: string | null;
  decisionReason: unknown;
  
  // Campaign details
  campaignId: string;
  campaignTitle: string;
  campaignType: string;
  campaignDescription: string | null;
  campaignStartAt: Date;
  campaignEndAt: Date;
}

async function getPostActionDetails(
  postId: string
): Promise<PostActionDetails | null> {
  try {
    const query = `
      SELECT 
        -- Post fields
        posts.uuid as "postId",
        posts.type as "postType",
        posts.content as "postContent",
        posts.added_at as "postAddedAt",
        posts.amount as "postAmount",
        
        -- Action fields
        actions.uuid as "actionId",
        actions.reply,
        actions.replied_at as "repliedAt",
        actions.reviewed_at as "reviewedAt",
        actions.decided_at as "decidedAt",
        actions.decision,
        actions.decision_reason as "decisionReason",
        
        -- Campaign fields
        campaigns.uuid as "campaignId",
        campaigns.title as "campaignTitle",
        campaigns.type as "campaignType",
        campaigns.description as "campaignDescription",
        campaigns.start_at as "campaignStartAt",
        campaigns.end_at as "campaignEndAt"
      FROM posts
      INNER JOIN actions ON actions.post_id = posts.uuid
      INNER JOIN campaigns ON campaigns.uuid = posts.campaign_id
      WHERE actions.uuid = $1
      LIMIT 1
    `;

    const result = await client.query(query, [postId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error fetching post action details:', error);
    throw new Error('Failed to fetch post action details');
  }
}

export const POST = async (req: Request) => {
  const insecureSession = await insecureGetSession()
  if (!insecureSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { postId, answer } = await req.json()

  const postActionDetails = await getPostActionDetails(postId)

  console.log('POT', postActionDetails, answer)

  // Anthropic API
  // @ts-expect-error - Not sure why this is throwing an error
  const postContent = postActionDetails?.postContent.text
  const response = await anthropicClient.messages.create({
    model: "claude-3-5-sonnet-latest",
    messages: [
      {
        role: "assistant",
        content: `You are an assistant who will decide if an answer given by a user is a good answer to a post. Only respond with a JSON object { "decision": "yes" | "no", "reason": "string" }.
        Some context about the post:
        Goal we are trying to achieve: ${postActionDetails?.campaignDescription}
        Question: ${postContent}
        `,
      },
      {
        role: "user",
        content: `Answer: ${answer}`,
      },
    ],
    max_tokens: 100, // Added required property
  })

  console.log('RESPONSE', response)
  // @ts-expect-error - Not sure why this is throwing an error
  const decision = JSON.parse(response.content[0].text)
  console.log('RESPONSE', decision)

  const success = decision.decision === 'yes'
  const actionId = postActionDetails?.actionId

  await client.query(`UPDATE actions SET decision = $1, decision_reason = $2, reply = $3, status = $4
                      WHERE uuid = $5`, [decision.decision, JSON.stringify(decision.reason), JSON.stringify({ text: answer }), success ? 'pending_payment' : 'rejected', actionId])

  console.log('DON', actionId)
  return NextResponse.json({ success: true, postId, answer })
}