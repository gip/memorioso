import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getIsUserVerified, MiniAppWalletAuthSuccessPayload, verifySiweMessage } from '@worldcoin/minikit-js'

interface IRequestPayload {
	payload: MiniAppWalletAuthSuccessPayload
	nonce: string
}

export const POST = async (req: NextRequest) => {
	const { payload, nonce } = (await req.json()) as IRequestPayload
    console.log('PAL', payload)
	if (nonce != (await cookies()).get('siwe')?.value) {
		return NextResponse.json({
			status: 'error',
			isValid: false,
			message: 'Invalid nonce',
		})
	}
	try {
		const validMessage = await verifySiweMessage(payload, nonce)
        console.log('VALID MESSAGE', validMessage)
        const userWalletAddress = payload.address
        const isUserVerified = await getIsUserVerified(userWalletAddress)
        console.log('IS USER VERIFIED', isUserVerified)
		return NextResponse.json({
			status: 'success',
			isValid: validMessage.isValid,
            isUserVerified: isUserVerified
		})
	} catch (error: unknown) {
		return NextResponse.json({
			status: 'error',
			isValid: false,
			message: error instanceof Error ? error.message : 'Unknown error',
		})
	}
}
