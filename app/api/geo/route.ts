import { NextRequest, NextResponse } from 'next/server'
import { getAddress } from '@/lib/geo'
import { insecureGetSession, insecureSetLocation } from '@/lib/insecure-session'

export const POST = async (req: NextRequest) => {
  const session = await insecureGetSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json()

  try {
    const { latitude, longitude } = body
    const address = await getAddress({ lat: latitude, lng: longitude })
    console.log('ADD', address)
    await insecureSetLocation({
      success: true,
      city: address.city,
      country: address.country,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
    })
    return NextResponse.json(address)
  } catch {
    await insecureSetLocation({ success: false })
    return NextResponse.json({ error: 'Error getting address' }, { status: 200 })
  }
}