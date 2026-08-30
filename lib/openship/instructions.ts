// Plain-text help for people and agents that arrive at /openship/agent.txt. The normative v1
// contract is the vendored skill; this file only explains Memorioso's advertised implementation.

import { getChangesConfig } from '@/lib/openship/changes-config'
import { getOpenshipCommit, getOpenshipManifest, OPENSHIP_VERSION } from '@/lib/openship/manifest'
import { OPENSHIP_LIMITS, getProtectedPaths, getWritablePaths, isApiWritable } from '@/lib/openship/policy'

const wrap = (text: string, indent: string, width = 86): string => {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length + indent.length > width) {
      lines.push(indent + line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(indent + line)
  return lines.join('\n')
}

const bullets = (paths: readonly string[]): string =>
  paths.map((filePath) => `    ${filePath}`).join('\n')

const changesInstructions = (origin: string): string => {
  const changes = getChangesConfig()
  const specification =
    `${origin}/openship/file/skills/openship/references/openship-changes.md`

  if (!changes.enabled || !changes.buildsDomain) {
    return `CHANGES
  This deployment advertises the Changes policy but does not currently accept
  submissions; POST /openship/changes answers 501. Read the protocol at:
  ${specification}
`
  }

  return `CHANGES
  This deployment accepts replacement patches. A proposal targets the exact Sources
  digest it read. The resulting candidate is isolated at a different domain and is
  never promoted to production automatically.

  1. GET ${origin}/openship/policy.json.
  2. GET ${origin}/openship/manifest.json and copy its digest.
  3. POST ${origin}/openship/changes with:

       { "openship": "1.0",
         "capability": "changes",
         "base": "<Sources digest>",
         "title": "<one line>",
         "intent": "<what this does and why>",
         "files": {
           "<path>": { "encoding": "utf-8", "content": "<replacement>" },
           "<path to delete>": null } }

  4. A successful submission returns the resulting digest, candidateOrigin, and
     statusUrl. Poll until status is ready, rejected, or failed. The public lifecycle
     is pending | processing | ready | rejected | failed. When ready, fetch the
     candidate's /openship/manifest.json and require its digest to equal the returned
     resulting digest.

  Writable:
${bullets(getWritablePaths())}

  Protected:
${bullets(getProtectedPaths())}
${isApiWritable() ? '\n  This deployment explicitly allows app/api/**.\n' : ''}
  Limits: ${OPENSHIP_LIMITS.filesPerChange} files, ${OPENSHIP_LIMITS.bytesPerFile / 1024} KB per
  file, ${OPENSHIP_LIMITS.bytesPerChange / 1024 / 1024} MB of replacement bytes.

  Full protocol: ${specification}
`
}

export const buildOpenshipInstructions = (origin: string): string => {
  const manifest = getOpenshipManifest()
  const commit = getOpenshipCommit()
  const mcp = process.env.LIBRO_SERVICE_URL
    ? new URL('/mcp', process.env.LIBRO_SERVICE_URL).toString()
    : null

  return `OPENSHIP ${OPENSHIP_VERSION}
${origin}

Memorioso implements OpenShip Sources and Changes. It does not publish an OpenShip
Systems document. All discovery and source GETs are public and CORS-readable.

PROJECT
  ${manifest.project.name}
${wrap(manifest.project.description, '  ')}

${commit ? `  Commit    ${commit.sha}${commit.dirty ? ' (dirty at build time)' : ''}\n` : ''}\
  Files     ${manifest.totals.files}
  Size      ${manifest.totals.bytes} bytes
  Digest    ${manifest.digest}

START HERE
  GET ${origin}/.well-known/openship.json

  The discovery document has "capability": "discovery" and a capabilities map.
  Its Sources entry links the manifest, bundle, exact-file endpoint, archive, and
  these instructions. Its Changes entry links policy, submission, and status.
  The advertised skill is served from the vendored package at:
  ${origin}/openship/file/skills/openship/SKILL.md

${mcp ? `MCP
  Connect to ${mcp} and call the public "openship" tool. Use
  { "operation": "manifest" } to inspect the verified file set, then
  { "operation": "read", "path": "<exact manifest path>" } for source files.
  OpenShip reads through this tool do not require OAuth.

` : ''}\
RETRIEVE SOURCES
  1. GET ${origin}/openship/manifest.json.
  2. GET ${origin}/openship/bundle.json.
  3. Require both payloads to say "openship": "1.0", "capability": "sources",
     and to carry the same digest.
  4. Require the bundle keys to equal the manifest paths exactly. Decode every
     entry, verify its byte size and SHA-256, then recompute the snapshot digest
     over sorted "<path>\\0<file-sha256>\\n" records.
  5. Write only declared safe repository-relative paths. Save the manifest as
     openship.json, install with pnpm, and run pnpm openship:check.

  Optional conveniences:
    GET ${origin}/openship/file/<exact-manifest-path>
    GET ${origin}/openship/source.tar.gz

${changesInstructions(origin)}
SECURITY
  Environment names are published; environment values and credentials are not.
  Candidate builds receive no production secrets and run in an isolated sandbox.
  A ready candidate is evidence of an isolated build, never production promotion.
`
}
