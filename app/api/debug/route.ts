import { NextRequest, NextResponse } from 'next/server'

// This just prints the body of the request to the console
// Only for debugging purposes, I hate eruda
export const POST = async (req: NextRequest) => {
  const body = await req.json()
  console.log('DEBUG', body)
  return NextResponse.json({ status: 'success' })
}