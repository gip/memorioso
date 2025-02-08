import { NextRequest, NextResponse } from 'next/server'
import { MiniAppPaymentSuccessPayload } from '@worldcoin/minikit-js'
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
  


interface IRequestPayload {
	payload: MiniAppPaymentSuccessPayload
	postsToBePaid: PostType[]
}

export async function POST(req: NextRequest) {
	const { payload, postsToBePaid } = (await req.json()) as IRequestPayload

	// const reference = 'TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO '
	await new Promise(resolve => setTimeout(resolve, 1000));
	const url = `https://developer.worldcoin.org/api/v2/minikit/transaction/${payload.transaction_id}?app_id=${process.env.WLD_APP_ID}`

	// TODO TODO TODO
	if (true /* payload.reference === reference */) {
		const response = await fetch(url,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${process.env.MEMORIOSO_API_KEY}`,
				},
			}
		)
		const transaction = await response.json()
		console.log('TRA', transaction)
		if (transaction.status != 'failed') {
      console.log('postsToBePaid', postsToBePaid)
			setActionsToPaid(postsToBePaid.map((post: PostType) => post.id))
			return NextResponse.json({ success: true })
		} else {
			return NextResponse.json({ success: false })
		}
	}
}