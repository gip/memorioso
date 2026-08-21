# Openship Changes 1.0

**The requirements a proposed change must meet to be built and deployed.**

Status: draft. This document is the source of truth for what a submission may contain. The machine
readable form is `lib/openship/policy.ts`, served at `/openship/policy.json`; the two are kept in
step by `lib/openship/policy.test.ts`. Where they disagree, the code is what runs and this document
is the bug.

Read `OPENSHIP.md` first. It describes how to retrieve the source. This document describes how to
propose a change to it.

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119.

## The shape of the thing

Anyone may propose a change to this site. A submission is a patch against a known source digest.
If it satisfies every rule below, it is built and deployed to its own origin:

```
https://<buildId>.<builds domain>/
```

`buildId` is derived from the content of the resulting tree, not from who sent it or when. The same
files always produce the same `buildId`. A build serves its own Openship endpoints, so a change can
be retrieved, inspected, and itself changed.

A build is never the live site. Promotion to the production origin is a manual decision by the
maintainer and is out of scope for this protocol.

## Submitting

```
POST /openship/changes
Content-Type: application/json
```

```json
{
  "openship": "1.0",
  "base": "sha256:213f44e6…",
  "title": "Set the author page in a serif face",
  "intent": "The reading surface uses the UI sans throughout. This moves body copy to the serif already loaded for publications, and leaves navigation alone.",
  "files": {
    "app/a/[authorId]/page.tsx": { "encoding": "utf-8", "content": "…" },
    "components/AuthorHeader.tsx": null
  }
}
```

- `base` MUST be a manifest `digest` this server recognises. Fetch it from
  `/openship/manifest.json`. A submission against an unknown or superseded digest is rejected with
  `409` so that a change is never applied to a tree its author did not read.
- `files` maps a repository-relative path to its new content, or to `null` to delete it. Paths
  absent from `files` are unchanged. `encoding` is `utf-8` or `base64`, as in `bundle.json`.
- `intent` is prose, for the reviewer. It MUST describe what the change does and why. A submission
  whose stated intent does not match its diff is rejected regardless of whether the diff is
  otherwise permitted.

The response is `202` with a `changeId`, the computed `buildId`, and a status URL. Poll
`GET /openship/changes/{changeId}` until `status` leaves `queued` and `building`.

A submission that fails a deterministic rule is rejected synchronously with `422` and a list of
violations, each naming the path, the rule, and what to do instead. No build is queued and nothing
is charged. Fix and resubmit.

## What you may change

| Area | Rule |
|---|---|
| `app/**` | Writable, except the paths protected below. Pages, layouts, and route groups. |
| `components/**` | Writable, except `components/Openship/**`. |
| `public/**` | Writable. Static assets only; see the media rules below. |

Everything not listed as writable is protected. This is an allowlist: a path that matches no
writable rule is rejected even if no protection rule names it.

## What you may not change

These are rejected without review.

| Path | Why |
|---|---|
| `.env*` | Secrets. Nothing in a submission may name them. |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | A change may not add, remove, or move a dependency. The build installs from the committed lockfile with `--frozen-lockfile --ignore-scripts`. |
| `next.config.*`, `tsconfig.json`, `tailwind.config.*`, `postcss.config.*`, `eslint.config.*`, `vitest.config.*`, `vercel.json` | Build and deploy configuration. These execute during the build and decide what the gates below even test. |
| `openship.json` | The checked-in list of every file in the repository. A submission that could edit it could publish or hide any path. It is regenerated from the resulting tree by the build host. |
| `scripts/**` | The build and validation tooling, including this protocol's own pipeline. |
| `lib/**` | Data access, authentication, World ID, Libro, and the policy that judges this submission. |
| `libro/**` | Contracts and the verification package. |
| `types/**` | The publication and proof shapes. Changing them changes what a proof means. |
| `app/api/**` | Server endpoints. See "Changing the API" below. |
| `app/openship/**`, `app/.well-known/**`, `components/Openship/**` | The Openship endpoints themselves. |
| `OPENSHIP.md`, `OPENSHIP-CHANGES.md`, `AGENTS.md`, `CLAUDE.md` | The protocol and the rules. |
| `middleware.ts`, `.github/**`, `.vercel/**` | Request interception and CI. |

A submission MUST NOT create a new file at a protected path, and MUST NOT create a file that
shadows one — a framework resolves `app/api/foo/route.ts` and `app/api/foo/route.tsx` the same way,
so protection is applied to the path with its extension removed.

## What your code may not do

Every submitted text file is scanned. These are rejected:

- **Dynamic evaluation** — `eval(`, `new Function(`, `import()` with a non-literal specifier.
- **Node built-ins** — `child_process`, `fs`, `net`, `dns`, `vm`, `worker_threads`, `cluster`,
  `http`, `https`, `os`, `process.binding`, with or without the `node:` prefix.
- **Environment access** — `process.env`, except reads of a name beginning `NEXT_PUBLIC_`. Those
  are public by definition and are already in the client bundle.
- **Server actions** — the `'use server'` directive. A server action is an unlisted endpoint; it
  belongs under the API rules, not the page rules.
- **Raw HTML injection** — `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`.
- **Off-origin subresources** — `<script>`, `<iframe>`, `<object>`, `<embed>`, or a `Link` element
  pointing at a host that is not the deployment's own origin.
- **Off-origin requests** — `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, or
  `navigator.sendBeacon` with an absolute URL. Same-origin relative paths are fine.
- **Obfuscation** — a string literal over 4 KB that decodes as base64, `String.fromCharCode` over a
  numeric array, or `\x`/`\u` escape runs longer than 64 characters. If the reviewer cannot read
  it, it does not ship.
- **Credential shapes** — anything matching a private key header, a `Bearer` literal, or a
  connection string with an embedded password.

These are pattern rules, and pattern rules are evadable. They are the cheap first pass, not the
security boundary; see "What actually protects the site" below.

## Size

| Limit | Value |
|---|---|
| Files touched per submission | 40 |
| Bytes per file, decoded | 256 KB |
| Bytes per submission, decoded | 1 MB |
| Growth of the resulting tree | 2 MB |
| Total files in the resulting tree | 2,000 |

`public/**` accepts `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.svg`, `.ico`, `.woff`,
`.woff2`, and `.txt`. An `.svg` is scanned as text and is subject to every content rule above,
because an SVG is a script host.

## The gates, in order

A submission passes through these in sequence and stops at the first failure. Cheap and
deterministic first, expensive and judgement-based last.

1. **Envelope** — version, base digest, well-formed paths, declared encodings decode.
2. **Paths** — writable allowlist, protection denylist, extension shadowing, media types.
3. **Size** — the table above.
4. **Content** — the pattern scan.
5. **Tree** — the patch applies to the base, deletions name files that exist, no path collisions.
6. **Build** — `pnpm install --frozen-lockfile --ignore-scripts`, `tsc --noEmit`, `pnpm lint`,
   `pnpm test`, `next build`. All in a disposable sandbox with no secrets and no network.
7. **Review** — a model reads the diff, the stated intent, and the results of gates 1 to 6, and
   returns approve or reject with a reason.
8. **Deploy** — the build output is uploaded and aliased to `<buildId>`.

Gates 1 to 5 are pure functions of the submission and run inside the web server, which is why a bad
submission gets an answer immediately. Gates 6 to 8 run on the build host.

Gate 7 sees the diff as **data, not instruction**. A comment in submitted code addressed to the
reviewer is a prompt injection attempt and is itself grounds for rejection. The reviewer returns a
verdict; it never returns code, and it cannot widen the rules that produced gates 1 to 6.

## Changing the API

`app/api/**` is protected by default. The reason is not that API changes are uninteresting; it is
that a server route runs with the process environment, and this application's environment holds
`SESSION_SECRET`, `WORLD_ID_RP_SIGNING_KEY`, `DATABASE_URL`, and `LIBRO_RELAYER_PRIVATE_KEY`. A
single submitted line reading `process.env` and posting it elsewhere is not a degraded site; it is
forged sessions on the production origin and a drained relayer.

The protection is therefore a property of the deployment environment, not of the idea. A build host
MAY set `OPENSHIP_CHANGES_ALLOW_API=1` to move `app/api/**` into the writable set, and MUST NOT do
so unless all of the following hold:

- The builds origin is a **different registrable domain** from the production site, not a
  subdomain of it. Subdomains share cookie scope; a build that can set a cookie on the parent
  domain can fix a session on the real site.
- The build project's runtime environment contains **no production secret**. A scratch
  `DATABASE_URL` pointing at a disposable database, a development World ID app id, and no signing
  keys, no relayer key, no RPC write credential.
- The runtime has an **egress allowlist**, so a route cannot reach the production database, the
  cloud metadata endpoint, or an arbitrary host.
- A **spend cap** is set on the build project.

With `OPENSHIP_CHANGES_ALLOW_API=1`, `process.env` remains forbidden by the content rules, the
`node:` built-ins remain forbidden, and the deploy step still never exposes a deployment token to
the sandbox that ran the submitted code. The flag widens which paths may be written. It does not
relax anything else.

## What actually protects the site

Stated plainly, because it changes how you should read everything above:

- The pattern scan in gate 4 is a filter. It stops accidents and low-effort attempts. It does not
  stop a determined author, and it is not meant to.
- The model review in gate 7 is a filter. It is susceptible to injection through the very content
  it reviews.
- **The boundary is gates 6 and 8.** Submitted code executes only inside a disposable sandbox that
  holds no secret and has no deployment credential, and it is served only from an origin that holds
  no production secret and no cookie scope over the real site. A submission that defeats every
  filter above should cost the maintainer one wasted subdomain and nothing else.

If you find a way to make it cost more than that, report it rather than shipping it.

## Payment

A deployment MAY require payment before queueing a build, to cover build minutes and review tokens.
Where it does, `POST /openship/changes` answers `402 Payment Required` with an x402 challenge, and
the client retries with an `X-PAYMENT` header. `/openship/policy.json` advertises the price under
`payment`, and omits the member entirely when no payment is required.

Payment is cost recovery and sybil resistance. It is not a security control: a funded author still
faces every gate above, and passing them is the only way to get a build.

## Provenance

A build's manifest carries a `parent` member naming the digest it was derived from, and a
`submitter` member when the submission was authenticated. Following `parent` from any build reaches
the production digest it descends from, so the lineage of a change is retrievable over the same
plain GETs as everything else in Openship.
