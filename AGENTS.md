# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

Memorioso is a Next.js App Router application for human-authored publications. Users sign in with World ID 4.0, create authors and drafts, sign publication payloads through IDKit proof verification, register publication/proof data on World Chain through Libro registries, and store publication/proof data in Postgres.

Core stack:

- Next.js App Router with React and TypeScript.
- Tailwind CSS plus shadcn-style primitives under `components/ui`.
- Raw Postgres queries through `pg`.
- TipTap editor for draft/publication content.
- World ID 4.0 IDKit session proofs for login and publication proofs for publishing.
- Libro protocol contracts under `libro/contracts`, currently using Foundry.

## Commands

Use pnpm in this repo; `pnpm-lock.yaml` is the lockfile.

- `pnpm dev` starts the local Next.js dev server.
- `pnpm build` builds the app.
- `pnpm start` serves a production build.
- `pnpm lint` runs the configured Next lint command.
- `pnpm test` runs the Vitest suite.
- `forge test` from `libro/contracts` runs Libro contract tests.

For non-trivial changes, run the narrowest relevant checks. For app or protocol helper changes, run at least `pnpm lint` and `pnpm test`; for routing, config, or server changes, prefer `pnpm build` as well when environment permits. For contract changes, run `forge test` from `libro/contracts`.

## Required Environment

The app expects these environment variables in local and deployed environments:

- `DATABASE_URL` for Postgres. `next build` must succeed without it: the `pg` pool in
  `lib/db/index.ts` is created on first use rather than on import, and the two build-time
  reads (`app/sitemap.ts`, `components/LatestPublications`) fall back to a sitemap of
  static routes and an empty feed. Any new prerendered read needs the same guard.
- `SESSION_SECRET` for the signed Memorioso session cookie.
- `NEXT_PUBLIC_APP_URL` for public links.
- `NEXT_PUBLIC_WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_RP_SIGNING_KEY`, and
  `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT` for World ID 4.0.
- `NEXT_PUBLIC_LIBRO_CHAIN_ID`, `NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS`, and optional
  `LIBRO_RPC_URL` / `NEXT_PUBLIC_LIBRO_RPC_URL`
  for Libro on-chain registration. Both accept a comma-separated list of World Chain endpoints
  and default to `LIBRO_WORLD_CHAIN_RPC_URLS` in `libro/core`.
- `X402_PAY_TO_ADDRESS`, `X402_ASSET_ADDRESS`, `X402_ASSET_NAME`, `X402_ASSET_VERSION`,
  `X402_DEFAULT_PRICE_USD`, and `X402_RELAYER_PRIVATE_KEY` for gated publications. Only
  read when something is actually gated, so a deployment with no gated publications does
  not need them. Missing them does not break a gated publication either: the read path
  goes through `tryGetPublicationAccessConfig` and falls back to sign-in only.

OpenShip Changes is off unless `OPENSHIP_CHANGES_ENABLED=1` and `OPENSHIP_BUILDS_DOMAIN` are both
set; the build host additionally needs `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`,
`ANTHROPIC_API_KEY`, and `OPENSHIP_SANDBOX`. See `.env.example`, the advertised policy endpoint,
and `skills/openship/references/openship-changes.md`.

Do not add fallback secrets or app ids in code. Keep missing-env failures explicit.

## Repository Map

- `app/` contains App Router pages, layouts, and route handlers.
- `app/api/**/route.ts` contains JSON API endpoints for auth-adjacent actions, authors, drafts, and publishing.
- `components/` contains feature components and shared UI primitives.
- `components/Editor/` contains the TipTap editor and editor-specific CSS.
- `lib/auth-user.ts` and `lib/auth-session.ts` contain the World ID backed app session helpers.
- `lib/world-id/` contains IDKit request, proof, and publication helpers.
- `lib/libro/` contains Libro contract ABIs, config, encoding, publication registration, and agent authorization helpers.
- `lib/db/` contains the Postgres pool, SQL schema, and cached read helpers.
- `lib/draft-crypto/` contains browser-side draft encryption: the WebCrypto primitives, the key
  wrappers and unlock flow, the per-device key cache, and the row helpers every draft surface reads through.
- `lib/access/` contains the gated-publication access decision, teaser, and payment grants.
- `lib/x402/` contains the x402 payment requirements, EIP-3009 verification, and settlement.
- `lib/openship/` contains the Openship read half (manifest, bundle) and the Changes write half
  (`policy.ts`, `change.ts`, `validate.ts`), plus `paths.ts`, the one path-pattern matcher.
- `scripts/openship-worker.mjs` is the build host for accepted changes; `scripts/openship-review.mjs`
  is its model review gate.
- `openship.json` is the checked-in manifest: the hand-authored project metadata plus the allowlist
  of every file the repository consists of. It is generated and committed like a lockfile —
  `pnpm openship:manifest` regenerates the file list, `pnpm openship:check` verifies it against
  disk, and `pnpm test` fails when the two disagree. It does not list itself.
- `libro/contracts/` contains the Foundry contract and tests for the unified `LibroRegistry`.
- `types/index.ts` contains publication, proof, author, and JSON content shapes used across app and API code.
- `public/` contains static metadata assets.

## Code Conventions

- Prefer TypeScript and the `@/` path alias for app imports.
- Preserve the existing mix of server components and client components. Add `'use client'` only when hooks, browser APIs, or client-side event handlers are required.
- Keep API route handlers in the App Router `route.ts` style and return `NextResponse.json(...)`.
- Use semicolon style consistently within the file being edited. The repo currently has a mix, so follow nearby code rather than normalizing unrelated files.
- Keep comments sparse and useful; avoid broad cleanup while making focused changes.
- Use existing UI primitives in `components/ui` and `lucide-react` icons when adding interface controls.
- Keep Tailwind styling consistent with the current restrained, text-first UI.

## Database Guidelines

- The database layer uses raw SQL with `pg`; do not introduce an ORM unless explicitly requested.
- Acquire clients with `pool.connect()` and release them in `finally`.
- Use parameterized SQL for all user-provided values.
- Wrap multi-step writes in transactions. On errors after `BEGIN`, roll back before returning.
- Keep `lib/db/schema.sql` in sync with any table or column expectations. There is no migration framework in this repo.
- Be careful with cached read helpers in `lib/db/objects.ts`; several are wrapped in React `cache`.

## Auth And Identity

- Server-side authentication should use `getAuthenticatedUser()` from `lib/auth-user.ts`.
- Authenticated routes identify users through the signed Memorioso session cookie, which points to a `users.world_id_session_id` created from a verified World ID 4.0 session proof.
- Author records belong to users. Always scope draft/author mutations by the authenticated user's database id.
- The World ID session proof is verified server-side before creating a local app session. Do not trust client-reported session ids without verifier confirmation.

## Publication And Proof Flow

- Draft publishing depends on exact agreement between the draft record and the signed publication payload.
- Preserve the `PublicationV1` field names in `types/index.ts`, including `author_id_libro`, `author_name_libro`, `publication_title`, `publication_content`, and related fields.
- IDKit publication verification uses per-challenge actions shaped as `written-by-a-human-v4-<challengeId>` and the canonical publication JSON as the signal. Changing payload shape or serialization affects proof validity.
- Published data stores the proof, signal, content, title, subtitle, version, and date in `publications`.
- Publication dates are validated server-side to be no later than now and no older than five minutes at publish time.
- Direct human publications use `LibroRegistry.verifySession(...)` with the registered handle's session commitment and exact canonical publication signal.
- Human-authorized agents are registered in the same registry by the handle owner's session, then sign documents with EIP-712. Keep this proof class semantically separate from direct human authorship.
- The agent publish flow carries no Memorioso session, so every step of it must be authorized by the agent key itself. `prepare` recovers the `AgentDocument` signature and `finalize` recovers a second, freshly timestamped `AgentDocumentFinalization` signature bound to the broadcast transaction hash. Do not treat a document registration id as authority: it is a lookup key, not a credential.
- Libro registries should be deployed with the WorldIDVerifier proxy address, not the implementation address. Derive the constructor `rpId` from `WORLD_ID_RP_ID` by interpreting the 16 hex characters after `rp_` as `uint64`.
- On-chain verification queries every configured endpoint in parallel and treats one matching handle-bound registration event as proof. Do not reduce it to a single endpoint: `worldchain-mainnet.g.alchemy.com/public` prunes its transaction index after roughly six hours, so it answers `eth_getTransactionReceipt` with null for older publications, which is indistinguishable from an unregistered signal.

## Encrypted Drafts

- Draft prose is encrypted in the browser. An `encryption = 'v1'` row carries only
  `drafts.ciphertext`; `title`, `subtitle`, and `content` are null, and
  `drafts_encryption_shape_check` enforces that a row is one shape or the other, so prose can
  never survive beside the ciphertext that replaced it.
- The envelope is AES-256-GCM over `{title, subtitle, content}` with `draftId` and `userId` as
  additional data, so a row cannot be transplanted onto another draft or another author. That
  binding is why the client picks the draft UUID on create rather than taking one back from the
  server.
- Encryption is opt-in per author and the choice lives in `users.draft_encryption`: NULL means
  they have not been asked, `'passphrase'` means they have a key, `'none'` means they were asked
  and declined. NULL and `'none'` are different answers — do not collapse them. A declining
  author's drafts are written as prose, exactly as they were before any of this existed, and
  they were told so in `DraftEncryptionSetup` before choosing.
- Encryption can be turned on later but never off: `POST /api/draft-keys` refuses
  `{ encryption: 'none' }` once a wrapper exists, because the drafts sealed under that key would
  still be ciphertext with nothing left to open them.
- The key is a random per-author DEK, wrapped twice in `user_draft_key_wrappers`: `passphrase`
  derives its KEK from a passphrase the author chose, and `recovery` from a code shown exactly
  once. Both are written together on the first store, so a forgotten passphrase is never fatal.
- A passphrase is stretched with **PBKDF2-SHA256**, not HKDF. It carries far less entropy than
  the key it wraps, and the wrapper it protects sits in the database this feature exists to
  devalue. The cost is stored per row in `kdf_iterations` rather than pinned only in code: a
  cost that cannot be read back can never be raised, because a wrapper written under the old
  count would stop deriving and be indistinguishable from a typo. The server enforces the floor;
  the client picks the number.
- `kekFingerprint` comes out of the **stretched** material, alongside the KEK, from one PBKDF2
  pass. Deriving it from the raw passphrase would make it a cheap offline oracle for guessing
  that passphrase and PBKDF2 would be protecting nothing. `lib/draft-crypto/index.test.ts`
  pins this. A recovery code needs no stretching — it is 128 random bits — and its derivation is
  unchanged, which is what keeps wrappers written before the passphrase existed openable.
- There was a third wrapper, `worldid`, deriving its KEK from `responses[0].session_nullifier[1]`
  of a session login. It did not work: `LibroRegistry._verifyAndConsumeSession` marks
  `sessionNullifier[0]` used on every registration, so the pair is per-proof replay protection,
  not a per-author identifier, and the value changed on every login. Do not reach for it again —
  a value stable enough to key from would also be sitting in `libro_publish_registrations.proof`
  and in a public on-chain event, which defeats the point.
- This hardens data at rest. It is not a defence against the running server, which serves the
  script that handles the passphrase.
- The unwrapped DEK is cached per device in IndexedDB as a non-extractable `CryptoKey`
  (`lib/draft-crypto/store.ts`) and cleared on sign-out. A page load has no secret in hand, so
  that cache is the only unlock that costs the author nothing; everything else asks.
- A recovery-code unlock hands the raw DEK bytes back to `DraftKeyProvider`, which holds them in
  a ref only long enough to offer a new passphrase. That is the one moment they exist — the
  cached key is imported non-extractable and cannot be read back out.
- Publishing is the one place the server needs prose: `POST /api/world-id/publish-context` takes
  it from the browser that just decrypted it. From there the challenge row is the authority —
  it is locked `FOR UPDATE` and single-use — so `finalize` writes `publications.content` from
  `storedPublication.publication_content`, not from the draft. `assertChallengeMatchesAuthor`
  still checks the author fields, which are plaintext and can still drift.
- `world_id_publish_challenges` holds that prose in the clear by necessity. It is the last
  readable copy in the database, so `cleanupFinishedPublishChallenges` sweeps consumed and
  abandoned rows. Adding a new place that stores draft prose means adding a sweep for it too.
- Every draft-reading surface goes through `revealDraftRow` / `revealDraftRows`
  (`lib/draft-crypto/rows.ts`); a row that will not decrypt comes back `locked`, never as an
  error. A new surface that lists or opens drafts must use them.
- The extension's inline-signing drafts stay `encryption = 'none'`: the server writes them and
  publishes them in one flow, and there is no browser holding a key at that point.

## Gated Publications

- Access is opt-in per publication and lives in `publications.access` / `drafts.access`.
  It must never enter `publications.signal`: that JSONB is the signed payload whose hash is
  registered on chain, and one extra key breaks `parseLibroPublication` and every manifest.
- Only articles can be gated. A teaser of a short is the whole short.
- Two things get a reader through the wall: any signed-in Memorioso user (every account is
  bound to a verified World ID session, so being signed in already proves personhood), or a
  settled x402 payment recorded in `publication_access_grants`.
- The signed body is reachable from more places than the article page. All of them are gated:
  the proof page's verification snippet, `/hash/[signalHash]`, the inline embed manifest,
  `/api/publications/[id]/libro-manifest`, and `publication_excerpt` in every feed
  (`mapPublicationInfoRow` truncates gated rows to a teaser). Adding a new surface that reads
  `publication_content` means adding a new access check.
- The teaser is derived from `extractReadableText` and rendered as plain text, never as
  truncated HTML: cutting markup risks unbalanced tags, and an image in the opening block
  would leak outright.
- Gating decisions are cacheable (`getCachedPublicationAccess`, keyed only by id); *viewer*
  access is not. Keep `resolvePublicationAccess` inside a Suspense boundary and out of any
  `'use cache'` scope — a request API inside a cached scope can pass `next build` and only
  fail at runtime. Do not reach for `'use cache: private'` here: it caches the unlocked body
  in browser memory and is unavailable in route handlers.
- The advertised price comes from `effectivePriceUsd`, which returns null when the x402
  env is absent. Read paths must handle that null — the wall drops its payment offer and
  the content/manifest routes answer 403 instead of a 402 nobody could satisfy. Throwing
  there instead takes down the whole article page for anonymous readers, since the gate
  renders inside a streamed Suspense boundary with no error boundary of its own.
- x402 settles without a facilitator, because none serves World Chain. The payer signs an
  EIP-3009 `TransferWithAuthorization` for USDC (`0x79A02482A880bCE3F13e09Da970dC34db4CD24d1`,
  6 decimals, EIP-712 domain `name: "USDC"`, `version: "2"`), and `X402_RELAYER_PRIVATE_KEY`
  submits it. That key is deliberately separate from `LIBRO_RELAYER_PRIVATE_KEY`: two senders
  on one EOA race on the account nonce, and settlement is the side that costs a payer money.
- Requirements advertise `network: "eip155:480"` because World Chain has no entry in the x402
  v1 named-network registry; `world-chain` is also accepted on input.
- Settlement order is reserve → broadcast → complete. The unique `authorization_nonce` is
  claimed before anything reaches the chain, so a replay cannot double-spend and a crash
  mid-settlement cannot take money without recording the grant.
## OpenShip Changes

The write half of OpenShip lets anyone submit a patch that, if it passes every gate, is built and
deployed to `https://<buildId>.<OPENSHIP_BUILDS_DOMAIN>`. The vendored v1 protocol package lives at
`skills/openship/` and is protected: a submission cannot edit it.

- `skills/openship/references/openship-changes.md` defines the portable contract;
  `lib/openship/policy.ts` publishes Memorioso's provider-specific writable paths and gates.
- Gates 1 to 5 are pure functions in `lib/openship/validate.ts` and run inside `POST
  /openship/changes`, so a bad submission is rejected in one round trip. Gates 6 to 8 run in
  `scripts/openship-worker.mjs`, which re-runs 1 to 5 first from the same module.
- `buildId` is the first 12 hex characters of the digest of the **resulting** tree, computed exactly
  as OpenShip Sources defines it. Do not derive it from the submitter, the time, or a counter: it being
  content-addressed is what lets anyone verify that a build's origin matches the source it serves.
- The worker's one load-bearing property is that submitted code runs in a container with no secret
  and, past install, no network, while `VERCEL_TOKEN` stays in the worker process and is only passed
  to `vercel deploy --prebuilt`, which never runs submitted code. Preserve that split.
- `getChangesConfig()` refuses to enable submissions when `OPENSHIP_BUILDS_DOMAIN` is the production
  host or a subdomain of it. Subdomains share cookie scope. This is a correctness constraint, not a
  preference.
- The pattern rules in `policy.ts` and the review in `openship-review.mjs` are filters, not the
  security boundary. Do not add a rule and conclude that something is now safe; the isolation of the
  build sandbox and the builds origin is what makes a defeated filter cheap.
- Adding a writable path means widening what a stranger can execute. `WRITABLE` is an allowlist so
  that a forgotten rule fails closed; keep it that way.

## Frontend Notes

- The editor supports both editable drafts and read-only publications through `components/Editor/index.tsx`.
- Draft and publication content is stored as `{ html: string }`. Structured TipTap JSON can be reintroduced later if a coordinated migration needs it.
- Public author URLs prefer handles under `/a/[authorId]`; UUID author paths redirect to handle paths when possible.
- Shared layout wraps pages in `WorldIdAuthProvider` and Vercel Analytics.

## Before Finishing Changes

- Check `git status --short` before and after edits.
- Do not revert unrelated user changes.
- Run the narrowest useful verification command available for the change. For most code changes, that is `pnpm lint`; for routing, config, or server changes, prefer `pnpm build` as well when environment permits.
- If verification cannot run because services or environment variables are missing, state that clearly in the final response.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
