import { NextResponse } from 'next/server'

/** Prevents the retired Memorioso database from accepting chain-facing writes after cutover. */
export function retiredLibroWriterResponse(): NextResponse | null {
  if (process.env.LIBRO_SERVICE_WRITES_ENABLED !== '1') return null
  return NextResponse.json({
    success: false,
    code: 'LIBRO_WRITER_MOVED',
    retryable: false,
    message: 'This legacy Libro write endpoint is disabled; use the Libro service API.',
  }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
}
