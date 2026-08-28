import { describe, expect, it } from 'vitest'
import { candidateSourcesMatch } from '@/lib/openship/candidate'

const digest = `sha256:${'a'.repeat(64)}`

describe('candidateSourcesMatch', () => {
  it('accepts only a v1 Sources manifest with the exact resulting digest', () => {
    expect(candidateSourcesMatch({ openship: '1.0', capability: 'sources', digest }, digest)).toBe(true)
    expect(candidateSourcesMatch({ openship: '1.0', capability: 'sources', digest: `sha256:${'b'.repeat(64)}` }, digest)).toBe(false)
    expect(candidateSourcesMatch({ openship: '1.0', capability: 'systems', digest }, digest)).toBe(false)
  })
})
