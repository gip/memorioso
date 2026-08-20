import type { NextResponse } from 'next/server'
import { getOpenshipChange } from '@/lib/db/openship-changes'
import { buildUrl, getChangesConfig } from '@/lib/openship/changes-config'
import { openshipDynamicJson, openshipOrigin } from '@/lib/openship/http'
import { OPENSHIP_CHANGES_VERSION } from '@/lib/openship/policy'

// Status of one submitted change. The only Openship response that is expected to move, hence
// no-store rather than the immutable caching the read half uses.

type Params = Promise<{ changeId: string }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: Params }
): Promise<NextResponse> {
  const { changeId } = await params
  // Checked before the query so a malformed id is a 404 rather than a database error.
  if (!UUID.test(changeId)) {
    return openshipDynamicJson(
      { openship: '1.0', error: 'not_found', message: `No change "${changeId}".` },
      404
    )
  }

  const record = await getOpenshipChange(changeId)
  if (!record) {
    return openshipDynamicJson(
      { openship: '1.0', error: 'not_found', message: `No change "${changeId}".` },
      404
    )
  }

  const config = getChangesConfig()

  return openshipDynamicJson({
    openship: '1.0',
    changes: OPENSHIP_CHANGES_VERSION,
    changeId: record.changeId,
    buildId: record.buildId,
    base: record.base,
    digest: record.digest,
    title: record.title,
    status: record.status,
    reason: record.reason,
    // The URL is derivable from the buildId before the build exists, so it is published from the
    // moment a change is queued. `deployed` is what says it answers.
    url:
      record.url ??
      (config.buildsDomain ? buildUrl(config.buildsDomain, record.buildId) : null),
    filesChanged: record.filesChanged,
    submittedAt: record.submittedAt,
    updatedAt: record.updatedAt,
    policy: `${openshipOrigin()}/openship/policy.json`,
  })
}
