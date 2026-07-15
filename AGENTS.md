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

- `DATABASE_URL` for Postgres.
- `SESSION_SECRET` for the signed Memorioso session cookie.
- `NEXT_PUBLIC_APP_URL` for public links.
- `NEXT_PUBLIC_WORLD_ID_APP_ID`, `WORLD_ID_RP_ID`, `WORLD_ID_RP_SIGNING_KEY`,
  `WORLD_ID_PUBLISH_ACTION_PREFIX`, and `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT` for World ID 4.0.
- `NEXT_PUBLIC_LIBRO_CHAIN_ID`, `NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS`,
  `NEXT_PUBLIC_LIBRO_AGENT_REGISTRY_ADDRESS`, and optional
  `LIBRO_RPC_URL` / `NEXT_PUBLIC_LIBRO_RPC_URL`
  for Libro on-chain registration.
- `WORLD_ID_AGENT_REGISTRATION_ACTION` for the agent registration proof action, defaulting to `register-agent-v1`.

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
- `libro/contracts/` contains the Foundry contracts and tests for `LibroProofRegistry` and `LibroAgentRegistry`.
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
- Direct human publications use `LibroProofRegistry` with a per-challenge action hash passed to the registry at registration time.
- Human-authorized agent documents use `LibroAgentRegistry`: a human registers an agent address with World ID action `register-agent-v1`, then the agent signs document payloads with EIP-712. Keep this proof class semantically separate from direct human authorship.
- Libro registries should be deployed with the WorldIDVerifier proxy address, not the implementation address. Derive the constructor `rpId` from `WORLD_ID_RP_ID` by interpreting the 16 hex characters after `rp_` as `uint64`.

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
