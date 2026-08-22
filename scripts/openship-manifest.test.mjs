import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MANIFEST_NAME,
  readManifest,
  REPO_ROOT,
  scanTree,
  verifyManifest,
  verifyManifestDetailed,
} from './openship-manifest.mjs'

const temporary = []

const fixture = (manifest, files) => {
  const root = mkdtempSync(path.join(tmpdir(), 'openship-manifest-'))
  temporary.push(root)

  for (const [filePath, content] of Object.entries(files)) {
    const absolute = path.join(root, filePath)
    mkdirSync(path.dirname(absolute), { recursive: true })
    if (content && content.symlinkTo) symlinkSync(content.symlinkTo, absolute)
    else writeFileSync(absolute, content)
  }
  writeFileSync(path.join(root, MANIFEST_NAME), JSON.stringify(manifest, null, 2))

  return root
}

afterEach(() => {
  while (temporary.length) rmSync(temporary.pop(), { recursive: true, force: true })
})

describe('the repository manifest', () => {
  it('is in bijection with the working tree', () => {
    expect(verifyManifest(readManifest(REPO_ROOT), REPO_ROOT)).toEqual([])
  })

  it('does not list itself', () => {
    const paths = readManifest(REPO_ROOT).files.map((entry) => entry.path)
    expect(paths).not.toContain(MANIFEST_NAME)
  })

  it('uses the checked-in manifest as an explicit allowlist', () => {
    const manifest = readManifest(REPO_ROOT)
    expect(manifest.files.length).toBeGreaterThan(0)
    expect(new Set(manifest.files.map((entry) => entry.path)).size).toBe(manifest.files.length)
  })
})

describe('verifyManifest', () => {
  it('accepts a tree that matches', () => {
    const root = fixture({ files: [{ path: 'a.txt' }, { path: 'dir/b.txt' }] }, {
      'a.txt': 'a',
      'dir/b.txt': 'b',
    })
    expect(verifyManifest(readManifest(root), root)).toEqual([])
  })

  it('reports a file on disk that the manifest does not list', () => {
    const root = fixture({ files: [{ path: 'a.txt' }] }, { 'a.txt': 'a', 'stray.txt': 'x' })
    expect(verifyManifest(readManifest(root), root)).toEqual([
      expect.stringContaining('stray.txt is on disk but not in openship.json'),
    ])
  })

  it('reports a manifest entry with nothing on disk', () => {
    const root = fixture({ files: [{ path: 'a.txt' }, { path: 'gone.txt' }] }, { 'a.txt': 'a' })
    expect(verifyManifest(readManifest(root), root)).toEqual([
      expect.stringContaining('gone.txt is in openship.json but not on disk'),
    ])
  })

  it('ignores what the ignore list covers', () => {
    const root = fixture({ ignore: ['out/**'], files: [{ path: 'a.txt' }] }, {
      'a.txt': 'a',
      'out/bundle.js': 'x',
    })
    expect(verifyManifest(readManifest(root), root)).toEqual([])
  })

  it('prunes ignored basenames at any depth', () => {
    const root = fixture({ ignoreNames: ['node_modules'], files: [{ path: 'pkg/a.txt' }] }, {
      'pkg/a.txt': 'a',
      'pkg/node_modules/dep/index.js': 'x',
      'node_modules/other/index.js': 'x',
    })
    expect(verifyManifest(readManifest(root), root)).toEqual([])
  })

  // files[] is the allowlist and wins over ignore, which is what lets `.env**` be ignored while
  // `.env.example` stays published.
  it('publishes a listed file even when a pattern ignores it', () => {
    const root = fixture({ ignore: ['.env**'], files: [{ path: '.env.example' }] }, {
      '.env.example': 'DATABASE_URL=',
      '.env.local': 'DATABASE_URL=postgres://real',
    })
    expect(verifyManifest(readManifest(root), root)).toEqual([])
  })

  it('refuses an environment file even when the manifest names it', () => {
    const root = fixture({ files: [{ path: '.env.local' }] }, { '.env.local': 'SECRET=1' })
    // Refused as an entry, and then — having been refused — reported as an undeclared file. Both
    // messages are correct; what matters is that the path never reaches the published set.
    expect(verifyManifest(readManifest(root), root)).toContainEqual(
      expect.stringContaining('openship.json lists .env.local')
    )
  })

  it('refuses a manifest that lists itself', () => {
    const root = fixture({ files: [{ path: MANIFEST_NAME }] }, {})
    expect(verifyManifest(readManifest(root), root)).toEqual([
      expect.stringContaining('lists itself'),
    ])
  })

  it('reports a symlink declared with the wrong target', () => {
    const root = fixture(
      { files: [{ path: 'real.md' }, { path: 'link.md', type: 'symlink', target: 'other.md' }] },
      { 'real.md': 'x', 'link.md': { symlinkTo: 'real.md' } }
    )
    expect(verifyManifest(readManifest(root), root)).toEqual([
      expect.stringContaining('declared as a symlink to other.md but points at real.md'),
    ])
  })

  // The bundle serves a symlink's resolved content, so a client that ignores `type` writes a
  // regular file. The Sources transport permits that, so verification must accept it.
  it('accepts a declared symlink written as a regular file', () => {
    const root = fixture(
      { files: [{ path: 'AGENTS.md' }, { path: 'CLAUDE.md', type: 'symlink', target: 'AGENTS.md' }] },
      { 'AGENTS.md': 'x', 'CLAUDE.md': 'x' }
    )
    expect(verifyManifest(readManifest(root), root)).toEqual([])
  })

  it('refuses a declared regular file that is a symlink on disk', () => {
    const root = fixture({ files: [{ path: 'a.txt' }, { path: 'b.txt' }] }, {
      'a.txt': 'a',
      'b.txt': { symlinkTo: 'a.txt' },
    })
    expect(verifyManifest(readManifest(root), root)).toEqual([
      expect.stringContaining('b.txt is declared as a regular file but is a symlink'),
    ])
  })

  it('verifies sha256 and size when the manifest declares them', () => {
    const sha256 = (text) => createHash('sha256').update(text).digest('hex')
    const root = fixture(
      {
        files: [
          { path: 'ok.txt', size: 2, sha256: sha256('ok') },
          { path: 'tampered.txt', size: 4, sha256: sha256('good') },
        ],
      },
      { 'ok.txt': 'ok', 'tampered.txt': 'evil' }
    )
    expect(verifyManifest(readManifest(root), root)).toEqual([
      expect.stringContaining('tampered.txt hashes to'),
    ])
  })

  it('claims nothing about contents when the manifest omits hashes', () => {
    const root = fixture({ files: [{ path: 'a.txt' }] }, { 'a.txt': 'anything at all' })
    expect(verifyManifest(readManifest(root), root)).toEqual([])
  })

  it('reports a missing manifest rather than throwing', () => {
    expect(verifyManifest(null)).toEqual([expect.stringContaining('openship.json is missing')])
  })
})

describe('scanTree', () => {
  it('returns paths sorted, with symlinks classified as links', () => {
    const root = fixture({ files: [] }, {
      'b.txt': 'b',
      'a.txt': 'a',
      'link.txt': { symlinkTo: 'a.txt' },
    })
    expect(scanTree(root, [], [])).toEqual([
      { path: 'a.txt', type: 'file' },
      { path: 'b.txt', type: 'file' },
      { path: 'link.txt', type: 'symlink', target: 'a.txt' },
    ])
  })
})

describe('paths refused outright', () => {
  it('refuses a dependency directory at any depth', () => {
    const root = fixture({ files: [{ path: 'pkg/node_modules/dep/index.js' }] }, {
      'pkg/node_modules/dep/index.js': 'x',
    })
    expect(verifyManifest(readManifest(root), root)).toContainEqual(
      expect.stringContaining('pkg/node_modules/dep/index.js')
    )
  })

  it('still publishes .env.example', () => {
    const root = fixture({ files: [{ path: '.env.example' }] }, { '.env.example': 'KEY=' })
    expect(verifyManifest(readManifest(root), root)).toEqual([])
  })
})

// A deployment build treats `undeclared` as non-blocking and everything else as fatal. Build
// platforms write files into the workspace that were never in the repository — Vercel materialises
// a vercel.json from project settings — and an undeclared file is never published anyway, so it
// must not be able to kill a deploy. A manifest that names a file which is not there must.
describe('problem severity', () => {
  it('classifies an extra file on disk as undeclared', () => {
    const root = fixture({ files: [{ path: 'a.txt' }] }, { 'a.txt': 'a', 'injected.json': '{}' })
    expect(verifyManifestDetailed(readManifest(root), root)).toEqual([
      { kind: 'undeclared', message: expect.stringContaining('injected.json') },
    ])
  })

  it('classifies a manifest entry with nothing on disk as blocking', () => {
    const root = fixture({ files: [{ path: 'a.txt' }, { path: 'ghost.txt' }] }, { 'a.txt': 'a' })
    const kinds = verifyManifestDetailed(readManifest(root), root).map(problem => problem.kind)
    expect(kinds).toEqual(['missing'])
    expect(kinds).not.toContain('undeclared')
  })

  it('ignores the platform-generated vercel.json', () => {
    const manifest = readManifest(REPO_ROOT)
    expect(manifest.ignore).toContain('vercel.json')
  })
})
