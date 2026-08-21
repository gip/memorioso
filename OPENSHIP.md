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
| `/openship/policy.json` | `application/json` | No |
| `/openship/changes` | `application/json` | No |
| `/openship/changes/{changeId}` | `application/json` | No |

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
  "page": "https://memorioso.xyz/openship",
  "policy": "https://memorioso.xyz/openship/policy.json",
  "changes": "https://memorioso.xyz/openship/changes"
}
```

`openship`, `name`, and `manifest` are REQUIRED. `file` is a URI template with a single `{path}`
expansion. Absent optional endpoints MUST be omitted rather than sent as null. `commit` is
OPTIONAL and MUST be omitted where the served tree is not under version control.

### Manifest — `/openship/manifest.json`

Everything about the project except file contents.

```json
{
  "openship": "1.0",
  "generatedAt": "2026-08-18T22:48:45.874Z",
  "digest": "sha256:213f44e6…",
  "commit": { "sha": "9b927a2…", "ref": "stage", "committedAt": "2026-08-18T15:27:58-07:00", "dirty": false },
  "fileSet": "manifest",
  "project": { "name": "…", "description": "…", "homepage": "…", "repository": "…", "license": "…" },
  "stack": ["Next.js 16 App Router", "React 19", "…"],
  "structure": [{ "path": "app/", "purpose": "App Router pages, layouts, and route handlers." }],
  "setup": { "packageManager": "pnpm@10.34.5", "node": "24.x", "steps": ["…"], "commands": { "install": "pnpm install" } },
  "env": ["DATABASE_URL", "SESSION_SECRET"],
  "ignore": ["node_modules/**", ".next/**", ".env**"],
  "ignoreNames": ["node_modules", ".git"],
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

`commit` is OPTIONAL. A server whose tree is not under version control MUST omit it rather than
send empty or invented values; `digest` is what identifies a build, and `commit` is only ever a
convenience pointer into a history that may not exist. Where it is present, `commit.dirty` signals
that the payload was built from a working tree with uncommitted changes, so `commit.sha` does not
identify the served source. Clients SHOULD surface this rather than ignore it.

`project.repository` is OPTIONAL for the same reason: a project need not have a remote, and a tree
retrieved over Openship has no way to learn one. Omit it rather than guess.

`fileSet` names the source the file list was derived from — `manifest` where it came from the
checked-in manifest described below, `git` where it came from a version control index. It is how a
client sees that a server which publishes no `commit` is nevertheless publishing a declared file
set rather than the output of an unfiltered directory walk.

### Manifest source — `openship.json`

A server MUST determine its file set from an explicit declaration rather than by walking a
directory. The reference form of that declaration is a file named `openship.json`, checked into the
repository root, carrying the hand-authored half of the manifest and the list of every file the
project consists of:

```json
{
  "openship": "1.0",
  "project": { "name": "…", "description": "…" },
  "stack": ["…"], "structure": [{ "path": "app/", "purpose": "…" }], "setup": { "…": "…" },
  "ignore": ["node_modules/**", ".next/**", ".env**"],
  "ignoreNames": ["node_modules", ".git", ".DS_Store"],
  "files": [
    { "path": "app/page.tsx" },
    { "path": "CLAUDE.md", "type": "symlink", "target": "AGENTS.md" }
  ]
}
```

`files` is an **allowlist**. A path it does not name is not published, so a forgotten rule fails
closed and a secret that nobody declared cannot be served even by mistake.

Sizes and hashes are deliberately absent: they are derived from the bytes on disk at build time, so
a committed manifest can never disagree with the files beside it, and it changes only when a path is
added, removed, or renamed. A server MAY carry `size` and `sha256` anyway — `/openship/manifest.json`
does — and a reader that finds them SHOULD verify them rather than trust them.

Because `/openship/manifest.json` is a superset of this file, a client reconstructing a repository
can save the served manifest as `openship.json` verbatim and have a working source of truth. That is
what lets a retrieved copy build, serve its own Openship endpoints, and report the same `digest` as
the deployment it came from, with no version control anywhere in the loop.

#### The manifest is not in the tree it describes

`openship.json` MUST NOT appear in its own `files` array, and is not part of the `digest`. Two
reasons, one practical and one structural:

- An entry for itself would have to contain its own hash, which has no fixed point.
- A `digest` that covered the manifest would no longer be a function of the source alone. A server
  that regenerates the manifest when applying a change would move the digest by regenerating it, and
  the content-addressed `buildId` in the Changes extension would stop being predictable from the
  submission.

So the manifest describes the tree the way an index describes a book. Every other file on disk is
either in `files` or matched by `ignore`/`ignoreNames`.

#### Completeness

`ignore` uses the same `/`-separated prefix grammar as the policy document: a trailing `/**` matches
a directory and its descendants. `ignoreNames` lists **basenames** pruned at any depth, which the
prefix grammar cannot express and which a workspace with a `node_modules` under every package needs.

`files` takes precedence over both. That is what lets `.env**` be ignored wholesale while
`.env.example` — a declared, published file — survives.

A client that has written a tree SHOULD verify that the files on disk and the paths in `files` are
**the same set**, treating any difference in either direction as an error: a file on disk that
nothing declares or ignores, or a declared path with nothing on disk, means the retrieval is
incomplete or the manifest is wrong. This is the one integrity check that needs neither the network
nor a version control system.

Two rules make that check survive an honest retrieval:

- An entry declared `"type": "symlink"` is satisfied by a **regular file** holding the target's
  content, as well as by an actual link to the declared target. The bundle and file endpoints serve
  a symlink's resolved content precisely so a client that ignores `type` still gets a working tree,
  and such a client MUST NOT then fail its own verification. The reverse does not hold: a path
  declared as a regular file that is a link on disk is a substitution the manifest never described.
- Where an entry carries `size` or `sha256`, a client SHOULD verify them against the bytes on disk.
  Where it carries neither, nothing is claimed about the contents and nothing is checked. This is
  what makes a manifest saved from `/openship/manifest.json` a full offline integrity check of the
  retrieval, while a checked-in `openship.json` stays a statement about paths alone.

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

## Extension: Changes

The endpoints above are the read half. A server MAY also accept proposed changes to its own source,
which turns Openship from a way to copy an application into a way to contribute to one. A server
that does so MUST implement all three of `/openship/policy.json`, `POST /openship/changes`, and
`GET /openship/changes/{changeId}`, and MUST advertise `policy` and `changes` in its discovery
document.

This extension is specified as *Openship Changes 1.0*. A server declares support by serving
`"changes": "1.0"` in its policy document. Memorioso's rules are in `OPENSHIP-CHANGES.md`; what
follows is the transport, which is not specific to any one server's rules.

### Policy — `/openship/policy.json`

What a submission may contain, so a client learns the rules before writing rather than after
rejection.

```json
{
  "openship": "1.0",
  "changes": "1.0",
  "writable": ["app/**", "components/**", "public/**"],
  "protected": ["lib/**", "package.json", "…"],
  "limits": { "filesPerChange": 40, "bytesPerFile": 262144, "bytesPerChange": 1048576 },
  "contentRules": [{ "id": "dynamic-eval", "rule": "Dynamic evaluation", "message": "…" }],
  "document": "https://memorioso.xyz/openship/file/OPENSHIP-CHANGES.md"
}
```

`writable` and `protected` use `/`-separated prefixes, where a trailing `/**` matches a directory
and its descendants. `writable` is an allowlist: a path matching no entry MUST be rejected even
where no `protected` entry names it, so that a forgotten rule fails closed.

A server MUST NOT publish the regular expressions or other matchers behind `contentRules`. The
`message` tells an author what to do; the pattern is an implementation detail of a filter, and
publishing it publishes the evasion target.

### Submission — `POST /openship/changes`

The only Openship request that is not a `GET`. It carries `Content-Type: application/json`, so
unlike the read half it is preflighted and the server MUST implement `OPTIONS`.

```json
{
  "openship": "1.0",
  "base": "sha256:213f44e6…",
  "title": "Set the author page in a serif face",
  "intent": "Prose describing what this does and why.",
  "files": {
    "app/a/[authorId]/page.tsx": { "encoding": "utf-8", "content": "…" },
    "components/AuthorHeader.tsx": null
  }
}
```

A change is a **patch against a digest**, not a tree. `base` MUST be a manifest digest the server
recognises; a submission naming any other digest MUST be rejected with `409`, so that a change is
never applied to a tree its author did not read. `files` maps a path to its new content, or to
`null` to delete it; absent paths are unchanged. `encoding` is `utf-8` or `base64`, as in
`bundle.json`.

Responses:

| Status | Meaning |
|---|---|
| `202` | Accepted and queued. The body carries `changeId`, `buildId`, `url`, and `statusUrl`. |
| `200` | This exact resulting tree was already submitted; the body is its existing record. |
| `402` | Payment required. The body carries an x402 challenge; retry with `X-PAYMENT`. |
| `409` | `base` is not a digest this server is serving. Re-fetch the manifest and rebase. |
| `413` | The submission exceeds the published size limits. |
| `422` | One or more rules rejected the change. The body carries `violations`. |
| `501` | This server implements the read half only. |

A `422` body MUST carry a `violations` array, each entry naming the `rule` that rejected the change,
the `path` where applicable, and a `message` saying what to do instead. Rules that are decidable
from the submission and the base manifest alone SHOULD be evaluated synchronously, so that a
rejected submission costs one round trip rather than a queue position.

### Build identity

A server that deploys accepted changes SHOULD derive the deployment's name from the **digest of the
resulting tree**, computed exactly as in the Integrity section below:

```
buildId = first 12 hex characters of digest(resulting files)
```

This makes the deployment content-addressed. The same files always produce the same `buildId`, an
identical resubmission is recognised as the same build rather than a second one, and — because a
build serves its own Openship endpoints — anyone can retrieve `https://{buildId}.…/openship/
manifest.json`, recompute the digest, and confirm that the origin's name matches the source it
serves. A `buildId` is therefore something a client verifies rather than something it is told.

### Status — `GET /openship/changes/{changeId}`

```json
{
  "openship": "1.0",
  "changes": "1.0",
  "changeId": "…", "buildId": "9f2c1a7b3e04",
  "base": "sha256:…", "digest": "sha256:…",
  "status": "deployed",
  "reason": null,
  "url": "https://9f2c1a7b3e04.example-builds.com"
}
```

`status` is one of `queued`, `building`, `reviewing`, `deployed`, `rejected`, or `failed`. `reason`
carries the explanation for `rejected` and `failed`. Because `buildId` is derived from the
submission, `url` is knowable before the build exists and SHOULD be published from the moment a
change is queued; `status` is what says whether it answers.

This is the one Openship response that changes over time, and it MUST be sent `no-store` rather
than with the immutable caching the read half uses.

### Isolation

A server that builds and serves submitted code is running code it did not write. Two requirements
follow, and a server that cannot meet them SHOULD implement the read half only:

- Builds MUST be served from a **different registrable domain** than the origin serving the
  production application — not a subdomain of it. Subdomains share cookie scope, so a build that can
  set a cookie on the parent domain can fix a session on the production site.
- The environment a build is compiled and served in MUST NOT contain any credential belonging to
  the production application.

Neither the mechanical rules in a policy document nor a review by a language model is a security
boundary; both are filters over what a determined author will send. The boundary is that submitted
code executes only where there is nothing to take and is served only from where there is nothing to
impersonate.

## Integrity

`digest` is computed over the manifest's file list, in ascending path order:

```
digest = "sha256:" + SHA256( concat over files of ( path + "\0" + sha256_hex + "\n" ) )
```

Three things pin this down:

- The file set is **the manifest's `files` array** — never a directory walk, and never the output of
  a version control command consulted at digest time. `openship.json` itself is excluded, as
  described under "Manifest source".
- The order is ascending by the path's UTF-8 bytes. Recursively walking the directory and sorting
  the result produces the same list, so a client may derive it either way.
- `sha256_hex` is over the file's raw bytes. Nothing else about a file — its size, media type,
  transport encoding, or symlink status — enters the digest, so two servers that make different
  choices about how to *serve* the same bytes still agree on what they are serving.

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
explicit source of truth rather than by walking a directory. The reference implementation uses the
`files` allowlist in `openship.json`, falling back to `git ls-files` where no manifest is present.

Both fail closed, but not in the same way, and the difference is worth stating. `git ls-files`
excludes ignored files *by construction*: a secret never added to the index cannot be published,
because there is no edit that would publish it. A checked-in manifest is an allowlist, so an
undeclared file is still unpublished — but declaring one is a single line of JSON. A server that
uses a manifest SHOULD therefore refuse to publish paths that are secrets by shape, whatever the
manifest says. The reference implementation refuses `.env*` (excepting `.env.example`, which carries
names without values), `node_modules/**`, and `.git/**` outright.

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

- `openship.json` — the checked-in manifest: hand-authored metadata plus the file allowlist.
- `scripts/openship-manifest.mjs` — regenerates and verifies it against the working tree.
- `scripts/build-openship.mjs` — builds the payload from that file set at build time.
- `lib/openship/manifest.ts` — composes the served manifest and provides the file lookup.
- `lib/openship/paths.ts` — the one path-pattern matcher, shared with the change policy.
- `app/.well-known/openship.json/`, `app/openship/*/` — the endpoints.
- `app/openship/page.tsx` — the human-facing page.

And the Changes extension:

- `OPENSHIP-CHANGES.md` — the rules a submission must satisfy, in prose.
- `lib/openship/policy.ts` — the same rules, machine-readable, served at `/openship/policy.json`.
- `lib/openship/change.ts` — path normalisation, patch application, and the buildId derivation.
- `lib/openship/validate.ts` — the gates that are decidable from a submission alone.
- `app/openship/changes/` — the submission and status endpoints.
- `scripts/openship-worker.mjs` — the build host: re-validate, build sandboxed, review, deploy.
- `scripts/openship-review.mjs` — the model review, which treats the diff as data.
