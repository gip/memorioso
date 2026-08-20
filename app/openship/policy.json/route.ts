import type { NextResponse } from 'next/server'
import { openshipOrigin, openshipResponse } from '@/lib/openship/http'
import { getOpenshipPolicy } from '@/lib/openship/policy'

// The machine-readable form of OPENSHIP-CHANGES.md. An agent reads this before writing a change, so
// that it learns the rules from the server rather than from a rejection.
export function GET(): NextResponse {
  const origin = openshipOrigin()
  return openshipResponse(
    JSON.stringify(getOpenshipPolicy(`${origin}/openship/file/OPENSHIP-CHANGES.md`), null, 2),
    'application/json; charset=utf-8'
  )
}
