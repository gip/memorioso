import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GENERATED = path.join(REPO_ROOT, 'lib', 'openship', 'generated', 'bundle.ts')

// The generated module is written by `prebuild`/`postinstall`; regenerate so the test is
// self-contained rather than dependent on install order.
execFileSync(
  'node',
  ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.join(REPO_ROOT, 'scripts', 'build-openship.mjs')],
  { cwd: REPO_ROOT }
)

const module_ = readFileSync(GENERATED, 'utf8')

const readExport = (name) => {
  const match = module_.match(new RegExp(`^export const ${name} = (.*)$`, 'm'))
  if (!match) throw new Error(`missing export ${name}`)
  return JSON.parse(match[1])
}

const files = JSON.parse(readExport('OPENSHIP_FILES_JSON'))
const bundle = JSON.parse(gunzipSync(Buffer.from(readExport('OPENSHIP_BUNDLE_GZIP_BASE64'), 'base64')).toString())

describe('openship payload', () => {
  // The security boundary: the file list is the allowlist in openship.json, so a path nobody
  // listed is a path nobody serves. If this ever fails, the build is publishing something it
  // should not.
  it('never includes ignored or untracked paths', () => {
    const forbidden = /(^|\/)(\.env\.local|\.env$|\.vercel|\.gstack|node_modules|\.next)(\/|$)/
    const leaked = files.map(file => file.path).filter(filePath => forbidden.test(filePath))
    expect(leaked).toEqual([])
  })

  it('matches openship.json exactly', () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'openship.json'), 'utf8'))
    const declared = manifest.files.map(entry => entry.path).sort()
    expect(files.map(file => file.path)).toEqual(declared)
  })

  // openship.json describes the tree and is not part of it, so it never appears in its own file
  // list — which is also what keeps the digest a function of the source rather than of a
  // description of the source.
  it('does not publish the manifest itself', () => {
    expect(files.map(file => file.path)).not.toContain('openship.json')
  })

  it('reports where the file set came from', () => {
    expect(readExport('OPENSHIP_FILE_SET')).toBe('manifest')
  })

  it('publishes env var names without values', () => {
    const envKeys = readExport('OPENSHIP_ENV_KEYS')
    expect(envKeys).toContain('SESSION_SECRET')
    expect(envKeys.every(key => /^[A-Z0-9_]+$/.test(key))).toBe(true)
  })

  it('round-trips every file back to its bytes on disk', () => {
    for (const file of files) {
      const entry = bundle.files[file.path]
      expect(entry, file.path).toBeDefined()
      const decoded = Buffer.from(entry.content, entry.encoding === 'base64' ? 'base64' : 'utf8')
      expect(decoded.length, file.path).toBe(file.size)
      // readFileSync follows the symlink, which is what the endpoints serve.
      expect(decoded.equals(readFileSync(path.join(REPO_ROOT, file.path))), file.path).toBe(true)
    }
  })

  it('declares the tracked symlink as a symlink', () => {
    const claude = files.find(file => file.path === 'CLAUDE.md')
    expect(claude?.type).toBe('symlink')
    expect(claude?.target).toBe('AGENTS.md')
  })

  it('has a bundle key set equal to the manifest file set', () => {
    expect(bundle.openship).toBe('1.0')
    expect(bundle.capability).toBe('sources')
    expect(Object.keys(bundle.files).sort()).toEqual(files.map(file => file.path).sort())
    expect(bundle.digest).toBe(readExport('OPENSHIP_DIGEST'))
  })
})
