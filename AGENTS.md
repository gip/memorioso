# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

Memorioso is a Next.js App Router application for human-authored publications. Users sign in with Worldcoin/World ID, create authors and drafts, sign publication payloads through MiniKit proof verification, and store publication/proof data in Postgres.

Core stack:

- Next.js App Router with React and TypeScript.
- Tailwind CSS plus shadcn-style primitives under `components/ui`.
- NextAuth v4 with a custom Worldcoin OAuth provider.
- Raw Postgres queries through `pg`.
- TipTap editor for draft/publication content.
- Worldcoin MiniKit proof verification for publishing.

## Commands

Use pnpm in this repo; `pnpm-lock.yaml` is the lockfile.

- `pnpm dev` starts the local Next.js dev server.
- `pnpm build` builds the app.
- `pnpm start` serves a production build.
- `pnpm lint` runs the configured Next lint command.

There is no test suite configured at the time this file was written. For non-trivial changes, run at least `pnpm lint` and, when environment variables and services are available, `pnpm build`.

## Required Environment

The app expects these environment variables in local and deployed environments:

- `DATABASE_URL` for Postgres.
- `NEXTAUTH_SECRET` for NextAuth.
- `WLD_CLIENT_ID` and `WLD_CLIENT_SECRET` for server-side Worldcoin OAuth.
- `NEXT_PUBLIC_WLD_CLIENT_ID` for MiniKit installation in the browser.
- `NEXT_PUBLIC_APP_URL` for public links.
- `APP_ID` for `verifyCloudProof` when publishing drafts.

Do not add fallback secrets or app ids in code. Keep missing-env failures explicit.

## Repository Map

- `app/` contains App Router pages, layouts, and route handlers.
- `app/api/**/route.ts` contains JSON API endpoints for auth-adjacent actions, authors, drafts, and publishing.
- `components/` contains feature components and shared UI primitives.
- `components/Editor/` contains the TipTap editor and editor-specific CSS.
- `lib/auth.ts` contains NextAuth configuration.
- `lib/db/` contains the Postgres pool, SQL schema, and cached read helpers.
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

- Server-side authentication should use `getServerSession(authOptions)`.
- Authenticated routes currently identify users through `session.user.name`, which is the Worldcoin subject. Preserve this unless intentionally changing the user model.
- Author records belong to users. Always scope draft/author mutations by the authenticated user's database id.
- The Worldcoin provider is configured in `lib/auth.ts`; keep OAuth checks and provider settings intact unless the task is specifically about auth.

## Publication And Proof Flow

- Draft publishing depends on exact agreement between the draft record and the signed publication payload.
- Preserve the `PublicationV1` field names in `types/index.ts`, including `author_id_libro`, `author_name_libro`, `publication_title`, `publication_content`, and related fields.
- MiniKit verification uses action `written-by-a-human` and `JSON.stringify(publication)` as the signal. Changing payload shape or serialization affects proof validity.
- Published data stores the proof, signal, content, title, subtitle, version, and date in `publications`.
- Publication dates are validated server-side to be no later than now and no older than five minutes at publish time.

## Frontend Notes

- The editor supports both editable drafts and read-only publications through `components/Editor/index.tsx`.
- Draft content is currently stored as `{ html: string }` in normal editor usage, while types also allow structured TipTap content. Preserve both forms unless doing a coordinated data migration.
- Public author URLs prefer handles under `/a/[authorId]`; UUID author paths redirect to handle paths when possible.
- Shared layout wraps pages in `NextAuthProvider`, `MiniKitProvider`, and Vercel Analytics.

## Before Finishing Changes

- Check `git status --short` before and after edits.
- Do not revert unrelated user changes.
- Run the narrowest useful verification command available for the change. For most code changes, that is `pnpm lint`; for routing, config, or server changes, prefer `pnpm build` as well when environment permits.
- If verification cannot run because services or environment variables are missing, state that clearly in the final response.
