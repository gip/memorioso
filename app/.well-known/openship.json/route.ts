import type { NextResponse } from 'next/server'
import { openshipOrigin, openshipResponse } from '@/lib/openship/http'
import {
  getOpenshipCommit,
  getOpenshipProject,
  OPENSHIP_ENDPOINTS,
  OPENSHIP_VERSION,
} from '@/lib/openship/manifest'

// Discovery document. Deliberately tiny: an agent that knows only the origin starts here.
export function GET(): NextResponse {
  const origin = openshipOrigin()
  const absolute = (endpoint: string) => `${origin}${endpoint}`
  const project = getOpenshipProject()
  const commit = getOpenshipCommit()

  return openshipResponse(
    JSON.stringify(
      {
        openship: OPENSHIP_VERSION,
        name: project.name,
        description: project.description,
        // Omitted, not nulled, when this tree is not under version control.
        ...(commit ? { commit: commit.sha } : {}),
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
