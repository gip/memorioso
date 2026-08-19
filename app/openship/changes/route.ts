import { NextResponse } from 'next/server'
import { getOpenshipChangeByBuildId, insertOpenshipChange } from '@/lib/db/openship-changes'
import { buildUrl, getChangesConfig } from '@/lib/openship/changes-config'
import type { OpenshipChangeSubmission } from '@/lib/openship/change'
import { openshipDynamicJson, openshipOrigin } from '@/lib/openship/http'
import { getOpenshipFiles, getOpenshipManifest } from '@/lib/openship/manifest'
import { OPENSHIP_CHANGES_VERSION, OPENSHIP_LIMITS } from '@/lib/openship/policy'
import { validateChange } from '@/lib/openship/validate'

// POST /openship/changes — the write half of Openship. See OPENSHIP-CHANGES.md.
//
// Gates 1 to 5 run here, synchronously, because they are pure functions of the submission and the
// base manifest. An author gets a specific answer in one round trip instead of a queue position
// followed by a failure. Gates 6 to 8 run on the build host; see scripts/openship-worker.mjs.

// A submission is bounded by OPENSHIP_LIMITS.bytesPerChange once decoded. Base64 inflates by 4/3
// and JSON escaping can double a pathological string, so the wire cap is deliberately looser than
// the decoded one; it exists to stop a body large enough to matter before it is parsed at all.
const MAX_BODY_BYTES = OPENSHIP_LIMITS.bytesPerChange * 4

const mediaTypeOf = (filePath: string): string => {
  const extension = /\.[^./]+$/.exec(filePath)?.[0].toLowerCase() ?? ''
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }
  return types[extension] ?? 'text/plain; charset=utf-8'
}

export async function POST(request: Request): Promise<NextResponse> {
  const config = getChangesConfig()
  if (!config.enabled || !config.buildsDomain) {
    return openshipDynamicJson(
      {
        openship: '1.0',
        error: 'changes_disabled',
        message:
          'This deployment does not accept changes. It serves the read half of Openship only.',
      },
      501
    )
  }

  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return openshipDynamicJson(
      {
        openship: '1.0',
        error: 'too_large',
        message: `A submission may be at most ${OPENSHIP_LIMITS.bytesPerChange} decoded bytes.`,
      },
      413
    )
  }

  let submission: OpenshipChangeSubmission
  try {
    submission = JSON.parse(raw) as OpenshipChangeSubmission
  } catch {
    return openshipDynamicJson(
      { openship: '1.0', error: 'invalid_json', message: 'The body is not valid JSON.' },
      400
    )
  }
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) {
    return openshipDynamicJson(
      { openship: '1.0', error: 'invalid_json', message: 'The body must be a JSON object.' },
      400
    )
  }

  const baseDigest = getOpenshipManifest().digest
  const result = validateChange(submission, {
    base: getOpenshipFiles(),
    baseDigest,
    mediaTypeOf,
  })

  if (!result.ok) {
    // A stale base is not the author's mistake in the way a policy violation is: they read a tree
    // that was current when they read it. It gets its own status so a client can rebase and retry
    // without parsing prose.
    const stale = result.violations.some(
      (item) => item.gate === 'envelope' && item.rule === 'base'
    )
    return openshipDynamicJson(
      {
        openship: '1.0',
        changes: OPENSHIP_CHANGES_VERSION,
        error: stale ? 'stale_base' : 'policy_violation',
        message: stale
          ? 'This change applies to a tree this server is no longer serving.'
          : `${result.violations.length} rule(s) rejected this change.`,
        base: baseDigest,
        policy: `${openshipOrigin()}/openship/policy.json`,
        violations: result.violations,
      },
      stale ? 409 : 422
    )
  }

  // Payment sits after validation on purpose: an author is never charged for a submission the
  // deterministic gates would have rejected for free.
  if (config.price && config.payTo) {
    const payment = request.headers.get('x-payment')
    if (!payment) {
      return openshipDynamicJson(
        {
          openship: '1.0',
          changes: OPENSHIP_CHANGES_VERSION,
          error: 'payment_required',
          message: 'Retry with an X-PAYMENT header.',
          accepts: [
            {
              scheme: 'exact',
              network: process.env.OPENSHIP_CHANGES_PRICE_NETWORK ?? 'base',
              maxAmountRequired: config.price,
              asset: config.priceAsset,
              payTo: config.payTo,
              resource: `${openshipOrigin()}/openship/changes`,
              description: 'One reviewed build of a proposed change.',
            },
          ],
        },
        402
      )
    }
  }

  const existing = await getOpenshipChangeByBuildId(result.tree.buildId)
  if (existing) {
    // The buildId is the digest of the resulting tree, so this is not a similar change: it is the
    // same tree, and it already has an answer.
    return openshipDynamicJson(
      {
        openship: '1.0',
        changes: OPENSHIP_CHANGES_VERSION,
        changeId: existing.changeId,
        buildId: existing.buildId,
        status: existing.status,
        reason: existing.reason,
        url: existing.url ?? buildUrl(config.buildsDomain, existing.buildId),
        statusUrl: `${openshipOrigin()}/openship/changes/${existing.changeId}`,
        message: 'This exact tree has already been submitted.',
      },
      200
    )
  }

  const patch: Record<string, { encoding: string; content: string } | null> = {}
  for (const path of result.changedPaths) {
    const body = result.patch.get(path)
    patch[path] =
      body === null || body === undefined
        ? null
        : { encoding: 'base64', content: body.toString('base64') }
  }

  const { record } = await insertOpenshipChange({
    buildId: result.tree.buildId,
    baseDigest,
    resultDigest: result.tree.digest,
    title: (submission.title as string).trim(),
    intent: (submission.intent as string).trim(),
    patch,
    filesChanged: result.changedPaths.length,
    bytes: result.tree.addedBytes,
    submitter: null,
  })

  return openshipDynamicJson(
    {
      openship: '1.0',
      changes: OPENSHIP_CHANGES_VERSION,
      changeId: record.changeId,
      buildId: record.buildId,
      base: baseDigest,
      digest: record.digest,
      status: record.status,
      url: buildUrl(config.buildsDomain, record.buildId),
      statusUrl: `${openshipOrigin()}/openship/changes/${record.changeId}`,
      message:
        'Queued. The build runs the remaining gates; poll statusUrl until status leaves queued and building.',
    },
    202
  )
}

// The read half needs no OPTIONS, but a POST with Content-Type: application/json is not a CORS
// simple request, so this one is preflighted and the handler is required.
export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT',
      'Access-Control-Max-Age': '86400',
    },
  })
}
