import type { NextResponse } from 'next/server'
import { openshipOrigin, openshipResponse } from '@/lib/openship/http'
import {
  OPENSHIP_AGENT,
  OPENSHIP_CAPABILITY_DESCRIPTIONS,
  getOpenshipCommit,
  getOpenshipProject,
  OPENSHIP_ENDPOINTS,
  OPENSHIP_VERSION,
} from '@/lib/openship/manifest'

// The v1 front door. Memorioso implements Sources and Changes, deliberately not Systems.
export function GET(request: Request): NextResponse {
  const origin = openshipOrigin(request)
  const absolute = (endpoint: string) => `${origin}${endpoint}`
  const project = getOpenshipProject()
  const commit = getOpenshipCommit()
  const mcp = process.env.LIBRO_SERVICE_URL
    ? new URL('/mcp', process.env.LIBRO_SERVICE_URL).toString()
    : null

  return openshipResponse(
    JSON.stringify(
      {
        openship: OPENSHIP_VERSION,
        capability: 'discovery',
        project,
        ...(commit ? { commit: commit.sha } : {}),
        agent: {
          ...OPENSHIP_AGENT,
          skill: absolute(OPENSHIP_ENDPOINTS.skill),
        },
        page: absolute(OPENSHIP_ENDPOINTS.page),
        capabilities: {
          sources: {
            description: OPENSHIP_CAPABILITY_DESCRIPTIONS.sources,
            manifest: absolute(OPENSHIP_ENDPOINTS.manifest),
            bundle: absolute(OPENSHIP_ENDPOINTS.bundle),
            ...(mcp ? { mcp } : {}),
            file: absolute(OPENSHIP_ENDPOINTS.file),
            archive: absolute(OPENSHIP_ENDPOINTS.archive),
            instructions: absolute(OPENSHIP_ENDPOINTS.instructions),
          },
          changes: {
            description: OPENSHIP_CAPABILITY_DESCRIPTIONS.changes,
            policy: absolute(OPENSHIP_ENDPOINTS.policy),
            submit: absolute(OPENSHIP_ENDPOINTS.changes),
            status: absolute(OPENSHIP_ENDPOINTS.changeStatus),
          },
        },
      },
      null,
      2
    ),
    'application/json; charset=utf-8'
  )
}
