// Hand-authored half of the Openship manifest: what a machine cannot derive from the file list.
// The derived half (files, hashes, commit, digest) comes from scripts/build-openship.mjs.

export type OpenshipDirectory = {
  path: string
  purpose: string
}

export const OPENSHIP_PROJECT = {
  name: 'Memorioso',
  description:
    'A Next.js application for human-authored publications. Users sign in with World ID 4.0, ' +
    'write drafts, sign publication payloads through IDKit proof verification, and register the ' +
    'publication and its proof on World Chain through the Libro registry.',
  homepage: 'https://memorioso.xyz',
  repository: 'https://github.com/memorioso/memorioso',
  license: 'See LICENSE in the source tree if present; otherwise all rights reserved.',
} as const

export const OPENSHIP_STACK = [
  'Next.js 16 App Router (cacheComponents enabled)',
  'React 19',
  'TypeScript 5.7',
  'Tailwind CSS 3 with shadcn-style primitives in components/ui',
  'Postgres via raw SQL through pg (no ORM)',
  'TipTap 2 for draft and publication content',
  'World ID 4.0 IDKit for session proofs and publication proofs',
  'viem for World Chain reads and writes',
  'Foundry for the Libro contracts',
  'Vitest for tests',
] as const

export const OPENSHIP_STRUCTURE: readonly OpenshipDirectory[] = [
  { path: 'app/', purpose: 'App Router pages, layouts, and route handlers.' },
  { path: 'app/api/', purpose: 'JSON API endpoints for auth, authors, drafts, and publishing.' },
  { path: 'components/', purpose: 'Feature components and shared UI primitives.' },
  { path: 'components/ui/', purpose: 'shadcn-style primitives (button, dialog, select, ...).' },
  { path: 'components/Editor/', purpose: 'TipTap editor and editor-specific CSS.' },
  { path: 'lib/auth-user.ts', purpose: 'Server-side authenticated user lookup.' },
  { path: 'lib/world-id/', purpose: 'IDKit request, proof, and publication helpers.' },
  { path: 'lib/libro/', purpose: 'Libro ABIs, config, encoding, registration, and agent authorization.' },
  { path: 'lib/db/', purpose: 'Postgres pool, SQL schema, migrations, and cached read helpers.' },
  { path: 'lib/openship/', purpose: 'The Openship manifest and bundle served by this endpoint.' },
  { path: 'libro/contracts/', purpose: 'Foundry sources and tests for the LibroRegistry contract.' },
  { path: 'libro/core/', purpose: 'Shared Libro verification package consumed by the app and extension.' },
  { path: 'libro/chrome-extension/', purpose: 'Chrome extension that verifies Libro publications in the browser.' },
  { path: 'scripts/', purpose: 'Database init/migrate tooling and this Openship build step.' },
  { path: 'types/', purpose: 'Publication, proof, author, and JSON content shapes.' },
  { path: 'public/', purpose: 'Static assets and generated Openship archive.' },
]

export const OPENSHIP_SETUP = {
  packageManager: 'pnpm@10.34.5',
  node: '24.x',
  steps: [
    'Write every file from the manifest to disk, preserving its path.',
    'Run `pnpm install` at the repository root (this is a pnpm workspace; see pnpm-workspace.yaml).',
    'Copy .env.example to .env.local and fill in real values. The app fails loudly on missing env vars by design.',
    'Run `pnpm db:init` against an empty Postgres database, or `pnpm db:migrate` against an initialized one.',
    'Run `pnpm dev` for the dev server, `pnpm build` for a production build.',
  ],
  commands: {
    install: 'pnpm install',
    dev: 'pnpm dev',
    build: 'pnpm build',
    test: 'pnpm test',
    lint: 'pnpm lint',
    contracts: 'cd libro/contracts && forge test',
  },
} as const
