import { NextRequest, NextResponse } from 'next/server'
import { MiniAppPaymentSuccessPayload } from '@worldcoin/minikit-js'

interface IRequestPayload {
	payload: MiniAppPaymentSuccessPayload
}

export async function POST(req: NextRequest) {
	const { payload } = (await req.json()) as IRequestPayload

	const reference = 'TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO TODO '
  
	// TODO TODO TODO
	if (true /* payload.reference === reference */) {
		const response = await fetch(
			`https://developer.worldcoin.org/api/v2/minikit/transaction/${payload.transaction_id}?app_id=${process.env.APP_ID}`,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${process.env.DEV_PORTAL_API_KEY}`,
				},
			}
		)
		const transaction = await response.json()
		if (transaction.reference == reference && transaction.status != 'failed') {
			return NextResponse.json({ success: true })
		} else {
			return NextResponse.json({ success: false })
		}
	}
}