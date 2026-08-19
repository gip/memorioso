import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getOpenshipPolicy,
  getProtectedPaths,
  getWritablePaths,
  OPENSHIP_CONTENT_RULES,
  OPENSHIP_LIMITS,
} from '@/lib/openship/policy'

// OPENSHIP-CHANGES.md is what an author reads and lib/openship/policy.ts is what runs. They drift
// silently unless something checks, and a rule that is enforced but undocumented is worse than one
// that is neither: the author cannot find out why they were rejected.
const DOCUMENT = readFileSync(
  path.join(process.cwd(), 'OPENSHIP-CHANGES.md'),
  'utf8'
)

describe('the policy and OPENSHIP-CHANGES.md agree', () => {
  it.each(getWritablePaths())('documents the writable path %s', (pattern) => {
    expect(DOCUMENT).toContain(pattern.replace('/**', ''))
  })

  it.each(getProtectedPaths())('documents the protected path %s', (pattern) => {
    // The document writes patterns for a reader (`next.config.*`) where the policy writes them for
    // a matcher (`next.config**`), so compare the stem both forms share.
    const stem = pattern.replace(/\*+$/, '').replace(/\/$/, '')
    expect(DOCUMENT).toContain(stem)
  })

  it.each(OPENSHIP_CONTENT_RULES.map((rule) => rule.rule))('documents the content rule "%s"', (rule) => {
    expect(DOCUMENT).toContain(rule)
  })

  it('documents every numeric limit', () => {
    const numbers = [
      OPENSHIP_LIMITS.filesPerChange,
      OPENSHIP_LIMITS.filesInTree,
    ]
    for (const value of numbers) {
      expect(DOCUMENT).toMatch(new RegExp(`\\b${value.toLocaleString('en-US')}\\b|\\b${value}\\b`))
    }
    // Byte limits are written in the document as KB and MB rather than as byte counts.
    expect(DOCUMENT).toContain('256 KB')
    expect(DOCUMENT).toContain('1 MB')
    expect(DOCUMENT).toContain('2 MB')
  })

  it('protects the files that decide what is permitted', () => {
    const protectedPaths = getProtectedPaths()
    // A submission that could edit these would only have to pass the gates once.
    for (const selfReferential of ['lib/**', 'scripts/**', 'OPENSHIP-CHANGES.md']) {
      expect(protectedPaths).toContain(selfReferential)
    }
  })

  it('never marks a protected prefix writable', () => {
    for (const writable of getWritablePaths()) {
      expect(getProtectedPaths()).not.toContain(writable)
    }
  })
})

describe('getOpenshipPolicy', () => {
  it('serves the rules an agent needs before writing a change', () => {
    const policy = getOpenshipPolicy('https://example.com/openship/file/OPENSHIP-CHANGES.md')
    expect(policy.openship).toBe('1.0')
    expect(policy.changes).toBe('1.0')
    expect(policy.writable).toEqual(getWritablePaths())
    expect(policy.protected).toEqual(getProtectedPaths())
    expect(policy.document).toContain('OPENSHIP-CHANGES.md')
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
