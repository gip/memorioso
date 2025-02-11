import { insecureGetUser } from "@/lib/insecure-api"
import { sendUSDCe } from "@/lib/pay"
import { NextResponse } from "next/server"
import { client } from '@/lib/db'
import { Post as PostType } from '@/types'

async function setActionsToPaid(actionIds: string[]): Promise<void> {
	if (!actionIds.length) {
	  return;
	}
  	
	try {
	  // Start a transaction
	  await client.query('BEGIN');
  
	  const query = `
		UPDATE actions
		SET 
		  status = 'paid',
		  modified_at = CURRENT_TIMESTAMP
		WHERE uuid = ANY($1::uuid[])
		RETURNING uuid;
	  `;
  
	  const result = await client.query(query, [actionIds]);
	  
	  // Check if we updated all the requested actions
	  if (result.rowCount !== actionIds.length) {
		throw new Error(`Expected to update ${actionIds.length} actions, but updated ${result.rowCount}`);
	  }
  
	  await client.query('COMMIT');
	  
	  console.log(`Successfully marked ${result.rowCount} actions as paid`);
	} catch (error) {
	  await client.query('ROLLBACK');
	  console.error('Error updating actions status:', error);
	  throw error;
	} finally {
	  client.release();
	}
}

export const POST = async (req: Request) => {
  const user = await insecureGetUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { address, amount, postsToBePaid } = await req.json()

  const receipt = await sendUSDCe(address, amount)

  await setActionsToPaid(postsToBePaid.map((post: PostType) => post.id))

  return NextResponse.json({ receipt })
}