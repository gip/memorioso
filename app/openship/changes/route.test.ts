import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  byBuildId: vi.fn(),
  config: vi.fn(),
}))

vi.mock('@/lib/db/openship-changes', () => ({
  insertOpenshipChange: mocks.insert,
  getOpenshipChangeByBuildId: mocks.byBuildId,
}))
vi.mock('@/lib/openship/changes-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/openship/changes-config')>()),
  getChangesConfig: mocks.config,
}))

import { getOpenshipManifest } from '@/lib/openship/manifest'
import { OPTIONS, POST } from './route'

const digest = () => getOpenshipManifest().digest

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://memorioso.xyz/openship/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

const change = (files: Record<string, unknown>) => ({
  openship: '1.0',
  base: digest(),
  title: 'Reword the Openship page intro',
  intent: 'The opening paragraph buries what the site is. This puts it in the first sentence.',
  files,
})

describe('POST /openship/changes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.config.mockReturnValue({
      enabled: true,
      buildsDomain: 'memorioso-builds.xyz',
      price: null,
      priceAsset: null,
      payTo: null,
    })
    mocks.byBuildId.mockResolvedValue(null)
    mocks.insert.mockImplementation(async (input: { buildId: string; resultDigest: string }) => ({
      created: true,
      record: {
        changeId: '11111111-2222-3333-4444-555555555555',
        buildId: input.buildId,
        digest: input.resultDigest,
        status: 'queued',
        reason: null,
        url: null,
      },
    }))
  })

  it('queues a valid change and returns the origin it will deploy to', async () => {
    const response = await post(
      change({ 'app/page.tsx': { encoding: 'utf-8', content: 'export default () => <p>new</p>\n' } })
    )
    expect(response.status).toBe(202)

    const body = await response.json()
    expect(body.status).toBe('queued')
    expect(body.buildId).toHaveLength(12)
    // The URL is derivable from the submission, so it is known before the build exists.
    expect(body.url).toBe(`https://${body.buildId}.memorioso-builds.xyz`)
    expect(body.statusUrl).toContain(body.changeId)
    expect(mocks.insert).toHaveBeenCalledOnce()
  })

  it('rejects a protected path with 422 and names the rule', async () => {
    const response = await post(
      change({ 'lib/auth-user.ts': { encoding: 'utf-8', content: 'export const x = 1\n' } })
    )
    expect(response.status).toBe(422)

    const body = await response.json()
    expect(body.error).toBe('policy_violation')
    expect(body.violations[0]).toMatchObject({ gate: 'path', rule: 'protected', path: 'lib/auth-user.ts' })
    expect(body.policy).toContain('/openship/policy.json')
    // Nothing was queued, so nothing was charged and no build was scheduled.
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('answers 409 for a stale base rather than folding it into policy violations', async () => {
    const response = await post({
      ...change({ 'app/page.tsx': { encoding: 'utf-8', content: 'x\n' } }),
      base: 'sha256:deadbeef',
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'stale_base', base: digest() })
  })

  it('rejects forbidden content before anything is queued', async () => {
    const response = await post(
      change({
        'app/page.tsx': {
          encoding: 'utf-8',
          content: 'const key = process.env.SESSION_SECRET\nexport default () => null\n',
        },
      })
    )
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      violations: [{ gate: 'content', rule: 'Environment access' }],
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('returns the existing record when the same tree is resubmitted', async () => {
    mocks.byBuildId.mockResolvedValue({
      changeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      buildId: '9f2c1a7b3e04',
      status: 'deployed',
      reason: null,
      url: 'https://9f2c1a7b3e04.memorioso-builds.xyz',
    })
    const response = await post(
      change({ 'app/page.tsx': { encoding: 'utf-8', content: 'export default () => <p>dupe</p>\n' } })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'deployed' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('answers 501 where the deployment serves the read half only', async () => {
    mocks.config.mockReturnValue({ enabled: false, buildsDomain: null, price: null, priceAsset: null, payTo: null })
    const response = await post(change({ 'app/page.tsx': { encoding: 'utf-8', content: 'x\n' } }))
    expect(response.status).toBe(501)
    await expect(response.json()).resolves.toMatchObject({ error: 'changes_disabled' })
  })

  it('challenges with 402 before queueing when a price is set', async () => {
    mocks.config.mockReturnValue({
      enabled: true,
      buildsDomain: 'memorioso-builds.xyz',
      price: '0.50',
      priceAsset: '0xasset',
      payTo: '0xpayee',
    })
    const response = await post(
      change({ 'app/page.tsx': { encoding: 'utf-8', content: 'export default () => <p>paid</p>\n' } })
    )
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      error: 'payment_required',
      accepts: [{ maxAmountRequired: '0.50', payTo: '0xpayee' }],
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('does not charge for a submission the free gates would reject', async () => {
    mocks.config.mockReturnValue({
      enabled: true,
      buildsDomain: 'memorioso-builds.xyz',
      price: '0.50',
      priceAsset: '0xasset',
      payTo: '0xpayee',
    })
    const response = await post(change({ 'package.json': { encoding: 'utf-8', content: '{}\n' } }))
    expect(response.status).toBe(422)
  })

  it('rejects a body that is not JSON', async () => {
    expect((await post('not json at all')).status).toBe(400)
  })

  it('answers the CORS preflight a JSON POST triggers', () => {
    const response = OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-PAYMENT')
  })
})
