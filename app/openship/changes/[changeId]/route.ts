import type { NextResponse } from 'next/server'
import { getOpenshipChange } from '@/lib/db/openship-changes'
import { buildUrl, getChangesConfig } from '@/lib/openship/changes-config'
import { publicChangeStatus } from '@/lib/openship/change'
import { openshipDynamicJson, openshipOrigin } from '@/lib/openship/http'

// Status of one submitted change. Public state is mapped from provider-internal worker phases.

type Params = Promise<{ changeId: string }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: Request,
  { params }: { params: Params }
): Promise<NextResponse> {
  const { changeId } = await params
  // Checked before the query so a malformed id is a 404 rather than a database error.
  if (!UUID.test(changeId)) {
    return openshipDynamicJson(
      { openship: '1.0', capability: 'changes', error: 'not_found', message: `No change "${changeId}".` },
      404
    )
  }

  const record = await getOpenshipChange(changeId)
  if (!record) {
    return openshipDynamicJson(
      { openship: '1.0', capability: 'changes', error: 'not_found', message: `No change "${changeId}".` },
      404
    )
  }

  const config = getChangesConfig()
  const candidateOrigin =
    record.url ?? (config.buildsDomain ? buildUrl(config.buildsDomain, record.buildId) : null)

  if (!candidateOrigin) {
    return openshipDynamicJson(
      {
        openship: '1.0',
        capability: 'changes',
        error: 'candidate_unavailable',
        message: 'This provider has no candidate origin configured.',
      },
      503
    )
  }

  return openshipDynamicJson({
    openship: '1.0',
    capability: 'changes',
    changeId: record.changeId,
    buildId: record.buildId,
    base: record.base,
    digest: record.digest,
    title: record.title,
    ...publicChangeStatus(record.status),
    reason: record.reason,
    // The URL is derivable from the buildId before the build exists, so it is published from the
    // moment a change is queued. `deployed` is what says it answers.
    candidateOrigin,
    filesChanged: record.filesChanged,
    submittedAt: record.submittedAt,
    updatedAt: record.updatedAt,
    statusUrl: `${openshipOrigin(request)}/openship/changes/${record.changeId}`,
    policy: `${openshipOrigin(request)}/openship/policy.json`,
  })
}
