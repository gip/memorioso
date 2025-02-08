import { NextRequest, NextResponse } from 'next/server'
import { getAddress } from '@/lib/geo'

export const POST = async (req: NextRequest) => {
  const body = await req.json()
  const { latitude, longitude } = body
  const address = await getAddress({ lat: latitude, lng: longitude })
  console.log('ADD', address)
  return NextResponse.json(address)
}