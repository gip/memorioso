import { describe, expect, it } from 'vitest'
import { buildUrl, isolatedFrom } from '@/lib/openship/changes-config'

// The single highest-value constraint in the design: builds must not share cookie scope with the
// production site. A build that can set a cookie on the parent domain can fix a session on the
// real one, and no amount of source review catches that.
describe('isolatedFrom', () => {
  it('rejects a subdomain of the production host', () => {
    expect(isolatedFrom('memorioso.xyz', 'https://memorioso.xyz')).toBe(false)
  })

  it('rejects a builds domain the production host sits under', () => {
    expect(isolatedFrom('xyz', 'https://memorioso.xyz')).toBe(false)
  })

  it('rejects a parent of the production host', () => {
    expect(isolatedFrom('memorioso.xyz', 'https://www.memorioso.xyz')).toBe(false)
  })

  it('accepts a genuinely separate registrable domain', () => {
    expect(isolatedFrom('memorioso-builds.xyz', 'https://memorioso.xyz')).toBe(true)
  })

  it('rejects sibling hosts on the same registrable domain', () => {
    expect(isolatedFrom('build.example.co.uk', 'https://www.example.co.uk')).toBe(false)
  })

  it('accepts anything against localhost, so development is not blocked', () => {
    expect(isolatedFrom('builds.localtest.me', 'http://localhost:3000')).toBe(true)
  })

  it('does not crash on an unparseable app URL', () => {
    expect(isolatedFrom('memorioso-builds.xyz', 'not a url')).toBe(true)
  })
})

describe('buildUrl', () => {
  it('puts the buildId in the subdomain', () => {
    expect(buildUrl('memorioso-builds.xyz', '9f2c1a7b3e04')).toBe(
      'https://9f2c1a7b3e04.memorioso-builds.xyz'
    )
  })
})
