import type { NextResponse } from 'next/server'
import { openshipOrigin, openshipResponse } from '@/lib/openship/http'
import { getChangesConfig } from '@/lib/openship/changes-config'
import { getOpenshipPolicy } from '@/lib/openship/policy'

// An agent reads this before writing so it learns provider policy before a rejection.
export function GET(request: Request): NextResponse {
  const origin = openshipOrigin(request)
  const config = getChangesConfig()
  return openshipResponse(
    JSON.stringify(
      getOpenshipPolicy(
        `${origin}/openship/file/skills/openship/references/openship-changes.md`,
        { enabled: config.enabled, paymentRequired: Boolean(config.price && config.payTo) }
      ),
      null,
      2
    ),
    'application/json; charset=utf-8'
  )
}
