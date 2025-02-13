import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { getIsUserVerified, MiniAppWalletAuthSuccessPayload, verifySiweMessage } from '@worldcoin/minikit-js'
import { client } from '@/lib/db';
import { insecureDeleteSession, insecureSetSession } from '@/lib/insecure-session';

interface CreateHumanInput {
  isHuman: boolean;
  address: string;
}

interface Human {
  uuid: string;
  wallet_address: string;
  name: string;
  is_human: boolean;
  created_at: Date;
  modified_at: Date;
}

async function createOrFindHuman(input: CreateHumanInput): Promise<Human> {
  if (!input.address) {
    throw new Error('Wallet address is required');
  }

  try {
    const query = `
      INSERT INTO humans (
        wallet_address,
        name,
        is_human
      ) 
      VALUES ($1, $2, $3)
      ON CONFLICT (wallet_address) DO NOTHING
      RETURNING *;
    `;

    // Normalize the wallet address to lowercase for consistency
    const normalizedAddress = input.address.toLowerCase();
    
    // Use wallet address as name for now
    const name = normalizedAddress;

    const result = await client.query(query, [normalizedAddress, name, input.isHuman]);

    // If no row was inserted (meaning it already existed), fetch the existing row
    if (result.rowCount === 0) {
      const existingHuman = await client.query(
        'SELECT * FROM humans WHERE wallet_address = $1',
        [normalizedAddress]
      );
      return existingHuman.rows[0];
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error creating/finding human:', error);
    throw error;
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
    await createOrFindHuman({
      address: user.walletAddress,
      isHuman: isUserOrbVerified
    })
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
