import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getIsUserVerified, MiniAppWalletAuthSuccessPayload, verifySiweMessage } from '@worldcoin/minikit-js'

interface IRequestPayload {
	payload: MiniAppWalletAuthSuccessPayload
	nonce: string
}

export const POST = async (req: NextRequest) => {
	const { payload, nonce } = (await req.json()) as IRequestPayload
	if (nonce != (await cookies()).get('siwe')?.value) {
	    return NextResponse.json({
			status: 'error',
			isValid: false,
			message: 'Invalid nonce',
		})
	}
	try {
		const validMessage = await verifySiweMessage(payload, nonce)
    const userWalletAddress = payload.address
    const isUserOrbVerified = await getIsUserVerified(userWalletAddress) // Proof of humans (according to TG!)
		return NextResponse.json({
			status: 'success',
			isValid: validMessage.isValid,
      isHuman: isUserOrbVerified
		})
	} catch (error: unknown) {
		return NextResponse.json({
			status: 'error',
			isValid: false,
			message: error instanceof Error ? error.message : 'Unknown error',
		})
	}
}
