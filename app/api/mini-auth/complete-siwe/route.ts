import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getIsUserVerified, MiniAppWalletAuthSuccessPayload, verifySiweMessage } from '@worldcoin/minikit-js'

interface IRequestPayload {
	payload: MiniAppWalletAuthSuccessPayload
	nonce: string
}

export const POST = async (req: NextRequest) => {
	const { payload, nonce } = (await req.json()) as IRequestPayload
  const cookieStore = await cookies()
	if (nonce != (await cookies()).get('siwe')?.value) {
      cookieStore.delete('insecure-session')
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

    const response = {
			status: 'success',
			isValid: validMessage.isValid,
      isHuman: isUserOrbVerified,
      address: userWalletAddress,
		}
    cookieStore.set('insecure-session', JSON.stringify(response), {
      secure: true,
      httpOnly: true,
    })
		return NextResponse.json(response)
	} catch (error: unknown) {
    cookieStore.delete('insecure-session')
		return NextResponse.json({
			status: 'error',
			isValid: false,
			message: error instanceof Error ? error.message : 'Unknown error',
		})
	}
}
