import type { NextResponse } from 'next/server'
import { openshipOrigin, openshipResponse } from '@/lib/openship/http'
import {
  getOpenshipCommit,
  OPENSHIP_ENDPOINTS,
  OPENSHIP_VERSION,
} from '@/lib/openship/manifest'
import { OPENSHIP_PROJECT } from '@/lib/openship/project'

// Discovery document. Deliberately tiny: an agent that knows only the origin starts here.
export function GET(): NextResponse {
  const origin = openshipOrigin()
  const absolute = (endpoint: string) => `${origin}${endpoint}`

  return openshipResponse(
    JSON.stringify(
      {
        openship: OPENSHIP_VERSION,
        name: OPENSHIP_PROJECT.name,
        description: OPENSHIP_PROJECT.description,
        commit: getOpenshipCommit().sha,
        manifest: absolute(OPENSHIP_ENDPOINTS.manifest),
        bundle: absolute(OPENSHIP_ENDPOINTS.bundle),
        file: absolute(OPENSHIP_ENDPOINTS.file),
        archive: absolute(OPENSHIP_ENDPOINTS.archive),
        instructions: absolute(OPENSHIP_ENDPOINTS.instructions),
        page: absolute(OPENSHIP_ENDPOINTS.page),
        policy: absolute(OPENSHIP_ENDPOINTS.policy),
        // Present whether or not this deployment accepts submissions: a client learns which from
        // /openship/policy.json rather than from the absence of a member.
        changes: absolute(OPENSHIP_ENDPOINTS.changes),
      },
      null,
      2
    ),
    'application/json; charset=utf-8'
  )
}
