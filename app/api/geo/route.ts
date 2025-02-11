import { NextRequest, NextResponse } from 'next/server'
import { getAddress } from '@/lib/geo'
import { insecureGetUser } from '@/lib/insecure-api'

export const POST = async (req: NextRequest) => {
  const user = await insecureGetUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { latitude, longitude } = body
  const address = await getAddress({ lat: latitude, lng: longitude })
  console.log('ADD', address)
  return NextResponse.json(address)
}