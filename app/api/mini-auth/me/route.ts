import { insecureGetUser } from '@/lib/insecure-api'
import { NextResponse } from 'next/server'

export const GET = async () => {
  const user = await insecureGetUser()
  if (!user) {
    return NextResponse.json(null, { status: 401 })
  }

  return NextResponse.json({ status: 'success', user })
}