// The Agent view and /openship/agent.txt serve this byte for byte. Keep it plain text: it is read
// by machines that will not render markdown, and by people looking over their agent's shoulder.

import { getOpenshipCommit, getOpenshipManifest, OPENSHIP_VERSION } from '@/lib/openship/manifest'

// Plain text is read in terminals and in a fixed-width block on /openship, so keep every line
// inside a sane column count rather than emitting one very long interpolated paragraph.
const wrap = (text: string, indent: string, width = 86): string => {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length + indent.length > width) {
      lines.push(indent + line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(indent + line)
  return lines.join('\n')
}

export const buildOpenshipInstructions = (origin: string): string => {
  const manifest = getOpenshipManifest()
  const commit = getOpenshipCommit()
  const { totals } = manifest

  return `OPENSHIP ${OPENSHIP_VERSION}
${origin}

You are reading the instructions for retrieving the complete source of this
application. Everything below is an unauthenticated HTTP GET. No git, no package
registry, no credentials.

PROJECT
  ${manifest.project.name}
${wrap(manifest.project.description, '  ')}

  Commit    ${commit.sha || 'unknown'}${commit.dirty ? ' (dirty tree at build time)' : ''}
  Files     ${totals.files}
  Size      ${totals.bytes} bytes
  Digest    ${manifest.digest}

THE SHORT VERSION
  1. GET ${origin}/openship/bundle.json
  2. For each entry in .files, write the decoded content to that path.
     Entries with "encoding": "base64" are base64; "utf-8" entries are literal.
  3. pnpm install
  4. cp .env.example .env.local and fill in real values.

  Or, if you have a shell:
     curl -sL ${origin}/openship/source.tar.gz | tar xz

ENDPOINTS
  GET /.well-known/openship.json
      Discovery. Points at everything below. Start here if you only know the origin.

  GET /openship/manifest.json
      Project metadata, stack, directory structure, setup steps, required env
      var names, and an index of every file: path, size, sha256, encoding, and
      media type. No file contents.

  GET /openship/bundle.json
      Every file's content in one response, keyed by path. The fastest complete
      retrieval. Shape:
        { openship, generatedAt, commit, digest,
          files: { "<path>": { encoding, content } } }

  GET /openship/file/<path>
      One file, raw. Text is served as text/plain; charset=utf-8. Example:
      ${origin}/openship/file/lib/libro/agent.ts
      Paths are matched exactly against the manifest; anything else returns 404.

  GET /openship/source.tar.gz
      The same file set as a gzipped tarball, symlinks preserved.

VERIFYING WHAT YOU GOT
  Every manifest entry carries a sha256 of the raw file bytes. The manifest
  digest is sha256 over "<path>\\0<sha256>\\n" for every file in sorted path
  order, so two deployments serving the same digest served the same source.

NOTES BEFORE YOU BUILD
  - A pnpm workspace (see pnpm-workspace.yaml): install from the repo root.
  - Node ${manifest.setup.node}, ${manifest.setup.packageManager}.
  - CLAUDE.md is a symlink to AGENTS.md in the real repository. The manifest
    marks it "type": "symlink" with a "target"; the file and bundle endpoints
    serve the resolved content, so writing it as a regular file also works.
  - The app has no fallback secrets and fails loudly on missing environment
    variables. Required names are in the manifest's "env" array; values are
    yours to supply.
  - AGENTS.md at the repository root is the guide for coding agents working in
    this codebase. Read it before changing anything.
  - What you retrieve has no git history. The build works without it, but this
    project's own Openship endpoints derive from \`git ls-files\`, so they stay
    empty in your copy until you run \`git init && git add -A\`.

  Required environment variables:
${manifest.env.map((key) => `    ${key}`).join('\n')}

  Repository layout:
${manifest.structure
  .map((entry) => `    ${entry.path}\n${wrap(entry.purpose, '        ')}`)
  .join('\n')}

THE PROTOCOL
  Openship is a convention, not a service: any site can implement these
  endpoints so that an agent can rebuild it from nothing but an origin. The
  specification is in OPENSHIP.md, which you can read at
  ${origin}/openship/file/OPENSHIP.md.
`
}
