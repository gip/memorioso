import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getIsUserVerified, MiniAppWalletAuthSuccessPayload, verifySiweMessage } from '@worldcoin/minikit-js'
import { client } from '@/lib/db';
import { insecureDeleteSession, insecureSetSession, User } from '@/lib/insecure-session';

async function createOrFindHuman(user: User): Promise<boolean> {
  if (!user.walletAddress) {
    throw new Error('Wallet address is required');
  }

  try {
    const normalizedAddress = user.walletAddress.toLowerCase();
    const query = `
      INSERT INTO humans (
        wallet_address,
        name,
        is_human
      ) 
      VALUES ($1, $2, $3)
      ON CONFLICT (wallet_address) DO UPDATE 
      SET name = EXCLUDED.name,
          is_human = EXCLUDED.is_human
      RETURNING *;
    `

    await client.query(query, [normalizedAddress, user.username, user.isHuman]);

    return true
  } catch (error) {
    console.error('Error creating/finding human:', error);
    throw error
  }
}

interface IRequestPayload {
  payload: MiniAppWalletAuthSuccessPayload
  nonce: string
}

export const POST = async (req: NextRequest) => {

  const { payload, nonce, user } = (await req.json()) as (IRequestPayload & { user: { walletAddress: string, username: string } })

  if (nonce != (await cookies()).get('siwe')?.value) {
      await insecureDeleteSession()
      return NextResponse.json({
      status: 'error',
      isValid: false,
      message: 'Invalid nonce',
    })
  }
  try {
    const validMessage = await verifySiweMessage(payload, nonce)
    const isUserOrbVerified = await getIsUserVerified(user.walletAddress) // Proof of humans (according to TG!)

    if(!validMessage.isValid) {
      await insecureDeleteSession()
      return NextResponse.json({
        status: 'error',
        isValid: false,
        message: 'Invalid message',
      })
    }

    const session = {
      status: 'success',
      user : {
        isVerified: isUserOrbVerified,
        isHuman: isUserOrbVerified,
        ...user
      },
    }
    insecureSetSession(session)
    await createOrFindHuman(session.user)
    return NextResponse.json(session)
  } catch (error: unknown) {
    await insecureDeleteSession()
    return NextResponse.json({
      status: 'error',
      isValid: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
