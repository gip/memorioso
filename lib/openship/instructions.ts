// The Agent view and /openship/agent.txt serve this byte for byte. Keep it plain text: it is read
// by machines that will not render markdown, and by people looking over their agent's shoulder.

import { getChangesConfig, type ChangesConfig } from '@/lib/openship/changes-config'
import { getOpenshipCommit, getOpenshipManifest, OPENSHIP_VERSION } from '@/lib/openship/manifest'
import { OPENSHIP_LIMITS, getProtectedPaths, getWritablePaths, isApiWritable } from '@/lib/openship/policy'

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

const bullets = (paths: readonly string[], indent = '    '): string =>
  paths.map((path) => `${indent}${path}`).join('\n')

/**
 * The write half, described where an agent is already reading. A deployment that does not accept
 * submissions still says so and still points at the specification, because "no endpoint here" and
 * "this protocol does not exist" are different facts and an agent should not have to guess which.
 */
const buildChangesSection = (origin: string, changes: ChangesConfig): string => {
  if (!changes.enabled || !changes.buildsDomain) {
    return `CHANGING THIS SITE
  This deployment serves the read half of Openship only: POST /openship/changes
  answers 501. The protocol for proposing a change is specified in
  OPENSHIP-CHANGES.md, which you can read at
  ${origin}/openship/file/OPENSHIP-CHANGES.md.

`
  }

  const limits = OPENSHIP_LIMITS

  return `CHANGING THIS SITE
  This deployment accepts proposed changes. Anyone may submit one. If it passes
  every gate it is built and deployed to its own origin at

      https://<buildId>.${changes.buildsDomain}

  where buildId is derived from the content of the resulting tree. The same files
  always produce the same buildId, so the URL is something you can verify rather
  than something you are told. A build is never the live site: promotion to the
  production origin is a manual decision by the maintainer.

  1. GET ${origin}/openship/policy.json and read the rules.
  2. GET ${origin}/openship/manifest.json and take its "digest".
  3. POST ${origin}/openship/changes with:

       { "openship": "1.0",
         "base": "<the digest from step 2>",
         "title": "<one line>",
         "intent": "<what this change does and why, in prose>",
         "files": {
           "<path>": { "encoding": "utf-8", "content": "<the new content>" },
           "<path to delete>": null } }

  4. You get 202 with a changeId and the buildId, or 422 with a list of
     violations naming the path and the rule that rejected it. Poll the returned
     statusUrl until status leaves "queued" and "building".

  What you may write:
${bullets(getWritablePaths())}

  What is protected, and rejected without review:
${bullets(getProtectedPaths())}
${isApiWritable() ? '\n  This deployment has OPENSHIP_CHANGES_ALLOW_API set, so app/api/** is writable.\n' : ''}
  Limits: ${limits.filesPerChange} files per change, ${limits.bytesPerFile / 1024} KB per file,
  ${limits.bytesPerChange / 1024 / 1024} MB per change.

  Your code may not use dynamic evaluation, Node built-ins, process.env other
  than NEXT_PUBLIC_*, server actions, raw HTML injection, off-origin
  subresources or requests, or encoded source. The full list, with the reason for
  each, is in OPENSHIP-CHANGES.md:
  ${origin}/openship/file/OPENSHIP-CHANGES.md

  Two things worth knowing before you spend effort on this. Your stated intent is
  read against your diff, and a diff that does something the intent does not
  mention is rejected even when every mechanical rule passes. And the reviewer
  treats your code as data: a comment addressed to it is a prompt injection
  attempt, and is grounds for rejection on its own.

`
}

export const buildOpenshipInstructions = (origin: string): string => {
  const manifest = getOpenshipManifest()
  const commit = getOpenshipCommit()
  const { totals } = manifest
  const changes = getChangesConfig()

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

  GET /openship/policy.json
      What a proposed change may contain: writable paths, protected paths, size
      limits, and the content rules. Read this before writing a change.

  POST /openship/changes
      Submit a proposed change. See CHANGING THIS SITE below.

${buildChangesSection(origin, changes)}
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
