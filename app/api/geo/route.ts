import { NextRequest, NextResponse } from 'next/server'
import { getAddress } from '@/lib/geo'
import { insecureGetSession } from '@/lib/insecure-session'

export const POST = async (req: NextRequest) => {
  const session = await insecureGetSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { latitude, longitude } = body
  const address = await getAddress({ lat: latitude, lng: longitude })
  console.log('ADD', address)
  return NextResponse.json(address)
}