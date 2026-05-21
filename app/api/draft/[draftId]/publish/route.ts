import { NextResponse } from 'next/server'

export async function PUT(): Promise<NextResponse> {
  return NextResponse.json({
    success: false,
    message: 'Libro on-chain registration is required. Use the publish prepare and finalize endpoints.',
  }, { status: 410 })
}
