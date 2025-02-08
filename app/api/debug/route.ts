import { NextRequest, NextResponse } from 'next/server'

export const POST = async (req: NextRequest) => {
  const body = await req.json()
  console.log('DEBUG', body)
  return NextResponse.json({ status: 'success' })
}