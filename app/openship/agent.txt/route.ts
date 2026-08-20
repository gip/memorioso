import type { NextResponse } from 'next/server'
import { openshipOrigin, openshipResponse } from '@/lib/openship/http'
import { buildOpenshipInstructions } from '@/lib/openship/instructions'

// Identical to the Agent view on /openship, so an agent and the person watching it read the
// same words.
export function GET(): NextResponse {
  return openshipResponse(buildOpenshipInstructions(openshipOrigin()), 'text/plain; charset=utf-8')
}
