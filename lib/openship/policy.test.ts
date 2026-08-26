import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getOpenshipPolicy,
  getProtectedPaths,
  getWritablePaths,
  OPENSHIP_CONTENT_RULES,
} from '@/lib/openship/policy'

// The vendored document defines the portable contract. The endpoint adds Memorioso's concrete
// path policy, numeric limits, and content-rule descriptions.
const DOCUMENT = readFileSync(
  path.join(process.cwd(), 'skills/openship/references/openship-changes.md'),
  'utf8'
)

describe('the policy implements the vendored OpenShip Changes contract', () => {
  it('vendors the replacement-patch and public lifecycle requirements', () => {
    expect(DOCUMENT).toContain('A file value replaces or creates that path')
    for (const status of ['pending', 'processing', 'ready', 'rejected', 'failed']) {
      expect(DOCUMENT).toContain(`\`${status}\``)
    }
    expect(DOCUMENT).toContain("candidate origin's advertised Sources Manifest")
  })

  it('protects the files that decide what is permitted', () => {
    const protectedPaths = getProtectedPaths()
    // A submission that could edit these would only have to pass the gates once.
    for (const selfReferential of ['lib/**', 'scripts/**', 'skills/openship/**']) {
      expect(protectedPaths).toContain(selfReferential)
    }
  })

  it('never marks a protected prefix writable', () => {
    for (const writable of getWritablePaths()) {
      expect(getProtectedPaths()).not.toContain(writable)
    }
  })

  it('publishes only the v1 exact-path or trailing-/** selector grammar', () => {
    for (const pattern of [...getWritablePaths(), ...getProtectedPaths()]) {
      expect(pattern.replace(/\/\*\*$/, '')).not.toContain('*')
    }
  })
})

describe('getOpenshipPolicy', () => {
  it('serves the rules an agent needs before writing a change', () => {
    const policy = getOpenshipPolicy(
      'https://example.com/openship/file/skills/openship/references/openship-changes.md',
      { enabled: true, paymentRequired: true }
    )
    expect(policy.openship).toBe('1.0')
    expect(policy.capability).toBe('changes')
    expect(policy.writable).toEqual(getWritablePaths())
    expect(policy.protected).toEqual(getProtectedPaths())
    expect(policy.document).toContain('skills/openship/references/openship-changes.md')
    expect(policy.enabled).toBe(true)
    expect(policy.payment).toEqual({ required: true, mechanism: 'x402', response: 402 })
  })

  it('publishes rule ids and messages but never the patterns themselves', () => {
    const policy = getOpenshipPolicy('https://example.com/doc')
    expect(policy.contentRules.length).toBe(OPENSHIP_CONTENT_RULES.length)
    // Serialising a RegExp would put the exact evasion target in the response body. The message
    // tells an author what to do; the pattern is an implementation detail of the filter.
    expect(JSON.stringify(policy)).not.toContain('\\b(?:from|require')
  })

  it('keeps app/api protected unless the deployment opted in', () => {
    // The default. OPENSHIP_CHANGES_ALLOW_API is read once at module load, so this asserts the
    // shipped default rather than trying to mutate it mid-test.
    expect(getProtectedPaths()).toContain('app/api/**')
  })
})
