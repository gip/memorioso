import type { NextResponse } from 'next/server'
import { openshipResponse } from '@/lib/openship/http'
import { getOpenshipBundleJson } from '@/lib/openship/manifest'

// Every file's content in one response. The canonical way for an agent to retrieve the repository.
//
// No OPTIONS handler: these are simple GETs with no custom headers, so no CORS preflight is ever
// sent, and exporting a second method would opt the whole route out of static prerendering.
export function GET(): NextResponse {
  return openshipResponse(getOpenshipBundleJson(), 'application/json; charset=utf-8')
}
