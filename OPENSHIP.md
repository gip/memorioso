# Openship 1.0

**A convention for a web application to publish its own source over plain HTTP GET.**

Status: draft. Memorioso is the reference implementation; the protocol is not specific to it.

## Motivation

An agent asked to understand, audit, fork, or rebuild a running web application usually gets a
repository URL, which is a different system with different access rules, or nothing at all. Openship
removes the indirection: the application serves its own source from its own origin, with a manifest
that describes what the project is, how it is structured, and how to build it.

The requirements are deliberately small. An Openship server needs no database, no authentication, no
session state, and no dynamic behaviour — every response can be a static file. A client needs nothing
but the ability to make GET requests and write files.

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119.

## Overview

Given an origin, a client retrieves the complete source in two requests:

```
GET https://example.com/.well-known/openship.json    → where everything lives
GET https://example.com/openship/bundle.json         → every file's content
```

## Endpoints

All Openship endpoints MUST be reachable by unauthenticated `GET`, MUST send
`Access-Control-Allow-Origin: *`, and MUST NOT require cookies, headers, or query parameters.

| Path | Content type | Required |
|---|---|---|
| `/.well-known/openship.json` | `application/json` | Yes |
| `/openship/manifest.json` | `application/json` | Yes |
| `/openship/bundle.json` | `application/json` | Yes |
| `/openship/file/{path}` | the file's media type | Yes |
| `/openship/source.tar.gz` | `application/gzip` | No |
| `/openship/agent.txt` | `text/plain` | No |
| `/openship` | `text/html` | No |

Openship requests are CORS "simple requests" — a bare `GET` with no custom headers — so no preflight
is sent and servers need not implement `OPTIONS`. A server MAY implement it, but should be aware
that on some frameworks exporting a second method opts the route out of static generation.

### Discovery — `/.well-known/openship.json`

The only path a client is required to know. It MUST be small and MUST carry absolute URLs, so a
client that follows them needs no knowledge of the layout above.

```json
{
  "openship": "1.0",
  "name": "Memorioso",
  "description": "A Next.js application for human-authored publications…",
  "commit": "9b927a2db9e8c744f3e21d1adf7c5fd83c4d3001",
  "manifest": "https://memorioso.xyz/openship/manifest.json",
  "bundle": "https://memorioso.xyz/openship/bundle.json",
  "file": "https://memorioso.xyz/openship/file/{path}",
  "archive": "https://memorioso.xyz/openship/source.tar.gz",
  "instructions": "https://memorioso.xyz/openship/agent.txt",
  "page": "https://memorioso.xyz/openship"
}
```

`openship`, `name`, and `manifest` are REQUIRED. `file` is a URI template with a single `{path}`
expansion. Absent optional endpoints MUST be omitted rather than sent as null.

### Manifest — `/openship/manifest.json`

Everything about the project except file contents.

```json
{
  "openship": "1.0",
  "generatedAt": "2026-08-18T22:48:45.874Z",
  "digest": "sha256:213f44e6…",
  "commit": { "sha": "9b927a2…", "ref": "stage", "committedAt": "2026-08-18T15:27:58-07:00", "dirty": false },
  "project": { "name": "…", "description": "…", "homepage": "…", "repository": "…", "license": "…" },
  "stack": ["Next.js 16 App Router", "React 19", "…"],
  "structure": [{ "path": "app/", "purpose": "App Router pages, layouts, and route handlers." }],
  "setup": { "packageManager": "pnpm@10.34.5", "node": "24.x", "steps": ["…"], "commands": { "install": "pnpm install" } },
  "env": ["DATABASE_URL", "SESSION_SECRET"],
  "endpoints": { "manifest": "/openship/manifest.json", "…": "…" },
  "totals": { "files": 275, "bytes": 1407212 },
  "files": [
    { "path": "app/page.tsx", "size": 4219, "sha256": "…", "encoding": "utf-8", "mediaType": "text/plain; charset=utf-8", "type": "file" },
    { "path": "CLAUDE.md", "size": 9, "sha256": "…", "encoding": "utf-8", "mediaType": "text/plain; charset=utf-8", "type": "symlink", "target": "AGENTS.md" }
  ]
}
```

Required members: `openship`, `digest`, `project`, `totals`, `files`. Every entry in `files` MUST
carry `path`, `size`, `sha256`, and `encoding`.

- `path` is relative to the repository root, uses `/` separators, and MUST NOT begin with `/` or
  contain a `.` or `..` segment.
- `size` and `sha256` describe the **raw file bytes**, before any encoding for transport.
- `encoding` is `utf-8` or `base64`, and tells a client how `bundle.json` and the discovery of file
  content are to be decoded. Servers SHOULD use `utf-8` wherever the bytes survive the round trip.
- `type` is `file` or `symlink`. A symlink entry MUST carry `target`.

`env` MUST contain variable **names only**. A server MUST NOT publish environment variable values,
even placeholder ones.

`commit.dirty` signals that the payload was built from a working tree with uncommitted changes, so
`commit.sha` does not identify the served source. Clients SHOULD surface this rather than ignore it.

### Bundle — `/openship/bundle.json`

Every file's content in one response, keyed by path.

```json
{
  "openship": "1.0",
  "generatedAt": "2026-08-18T22:48:45.874Z",
  "commit": { "sha": "9b927a2…" },
  "digest": "sha256:213f44e6…",
  "files": {
    "app/page.tsx": { "encoding": "utf-8", "content": "import type { Metadata }…" },
    "public/logo.png": { "encoding": "base64", "content": "iVBORw0KGgo…" }
  }
}
```

The key set of `files` MUST equal the set of `path` values in the manifest, and `digest` MUST match.
This is the intended retrieval path for agents: one request, no negotiation, and the whole tree.

Servers SHOULD serve this with transport compression. It is highly compressible and typically lands
within a few hundred kilobytes.

### File — `/openship/file/{path}`

One file, raw, with the media type declared in the manifest. Text files SHOULD be served as
`text/plain; charset=utf-8` so that they are readable in a browser rather than downloaded.

A server MUST resolve `{path}` by exact comparison against the manifest and MUST NOT resolve it
against a filesystem. A path absent from the manifest MUST return `404`. This turns path traversal
from something to filter into something that cannot be expressed: `..` is simply not a key.

For a `symlink` entry, a server SHOULD serve the resolved target's content, so that a client which
ignores `type` still reconstructs a working tree.

### Archive — `/openship/source.tar.gz`

The same file set as a gzipped tarball, so a person with a shell can do the obvious thing:

```sh
curl -sL https://example.com/openship/source.tar.gz | tar xz
```

Symlinks SHOULD be stored as symlinks. The archive MUST contain exactly the manifest's file set.

### Instructions — `/openship/agent.txt`

Plain-language instructions for an agent that landed here with no prior knowledge: what the project
is, which endpoints exist, and what to do after fetching. This is redundant with the manifest by
design — it costs one request and removes the need for the client to have implemented this
specification beforehand.

## Integrity

`digest` is computed over the manifest's file list, in ascending path order:

```
digest = "sha256:" + SHA256( concat over files of ( path + "\0" + sha256_hex + "\n" ) )
```

Two deployments reporting the same digest served the same source. A client SHOULD verify each file
against its `sha256` after decoding, and MAY compare the recomputed digest against the published one.

The digest does not establish *who* published the source, only that two retrievals agree. Clients
that need provenance should obtain the digest through a second channel.

## Caching

The payload is fixed for a given deployment, so responses SHOULD be sent with
`Cache-Control: public, max-age=31536000, immutable`. A new deployment produces a new digest at the
same URLs; clients that need to detect change SHOULD compare `digest` rather than rely on
revalidation.

## What a server must not publish

A server MUST publish only files it intends to be public, and MUST determine that set from an
explicit source of truth rather than by walking a directory. The reference implementation uses
`git ls-files`, which excludes ignored files by construction — secrets in an untracked `.env.local`,
build output, and dependency directories cannot appear in the manifest even by mistake.

A server MUST NOT publish environment variable values, credentials, private keys, or deployment
configuration. Serving source under Openship makes it public in every practical sense; treat the
decision as equivalent to opening the repository.

## Versioning

The `openship` member carries the specification version. Within a major version, members MAY be
added; existing members MUST NOT change meaning. Clients MUST ignore members they do not recognise.

## Extension: signed provenance (non-normative)

Because a manifest reduces to a single `digest`, that digest can be signed or registered externally
to bind a deployment to an identity. Memorioso registers publication signals on World Chain through
the Libro registry for exactly this reason; the same mechanism applied to an Openship digest would
let anyone verify not only that two people retrieved identical source, but who shipped it.

This is not part of Openship 1.0 and is not implemented.

## Reference implementation

Memorioso implements this specification:

- `scripts/build-openship.mjs` — builds the payload from `git ls-files` at build time.
- `lib/openship/manifest.ts` — composes the manifest and provides the file lookup.
- `lib/openship/project.ts` — the hand-authored metadata a machine cannot derive.
- `app/.well-known/openship.json/`, `app/openship/*/` — the endpoints.
- `app/openship/page.tsx` — the human-facing page.
