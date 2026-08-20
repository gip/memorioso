import type { NextResponse } from 'next/server'
import { openshipResponse } from '@/lib/openship/http'
import { getOpenshipManifest } from '@/lib/openship/manifest'

// The full index: project metadata plus one entry per file. No file contents.
export function GET(): NextResponse {
  return openshipResponse(
    JSON.stringify(getOpenshipManifest(), null, 2),
    'application/json; charset=utf-8'
  )
}
