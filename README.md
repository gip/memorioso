# Memorioso

Soon, most of the content accessible to us will have been created by machines. The space for human-created texts,
stories, novels, publications, articles, and pictures will shrink dramatically. Storing and preserving them will
become significantly more challenging. Our mission is to ensure human creativity thrives in the future by empowering
individuals to create, sign, share, verify, archive and pay for content made by other humans in a fully decentralized
and permissionless way. So simple. So important.

The first iteration of Memorioso (the product) and Libro (the protocol) is built on [World](https://world.org/), the real human network.

*Memorioso is currently in the [Make It Work](https://www.perplexity.ai/search/what-the-make-it-work-stage-wh-2iYhHhS4T9CCGkfezjDqwA) stage.*

## World ID 4.0 configuration

Memorioso uses IDKit 4.x for both login session proofs and publication proofs. Required environment variables:

- `SESSION_SECRET`
- `NEXT_PUBLIC_WORLD_ID_APP_ID`
- `WORLD_ID_RP_ID`
- `WORLD_ID_RP_SIGNING_KEY`
- `NEXT_PUBLIC_WORLD_ID_ENVIRONMENT=production`
- `NEXT_PUBLIC_LIBRO_CHAIN_ID=480`
- `NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS`
- `LIBRO_HANDLE_PERMIT_PRIVATE_KEY` (server-only and distinct from the RP signing key)
- `LIBRO_RELAYER_PRIVATE_KEY` for sponsored publication registration outside World App

Use `.env.example` as the starting point for local configuration.

## Database migrations

Run all pending database migrations with:

```sh
pnpm db:migrate
```

The runner prefers `DATABASE_URL_UNPOOLED` and falls back to `DATABASE_URL`, including values loaded from `.env.local` for local development. Use Neon’s pooled `-pooler` endpoint for the application’s `DATABASE_URL` and its direct endpoint for `DATABASE_URL_UNPOOLED`. The runner discovers numbered SQL files under `lib/db/migrations`, applies each pending migration in its own transaction, and records the filename and checksum in `memorioso_schema_migrations`. An advisory lock prevents concurrent deploys from running migrations at the same time.

The first run against an existing database safely replays the current idempotent migrations and records them. After a migration has been recorded, do not edit or rename it; add a new numbered migration instead. New databases must first be initialized with `lib/db/schema.sql`. Migration 013 is a destructive hard cutover: create and verify a database backup, then set `MEMORIOSO_DB_BACKUP_CONFIRMED=013_session_bound_handles` for that migration run.

## Libro on-chain registration

Libro protocol assets live under `libro/` so they can be split into a separate repository later:

- `libro/contracts` contains the Foundry project for `LibroRegistry`.
- `libro/skill` contains the Libro protocol skill and reference.

`LibroRegistry` permanently binds each normalized handle to the public 32-byte commitment of one World ID session. A short-lived EIP-712 permit authorizes the initial database handle claim, while `verifySession(...)` enforces every human publication against the exact canonical signal. The full session ID and proving seed never enter calldata, manifests, or publication JSON. The same registry binds session-authorized agents to a handle and verifies their later EIP-712 document signatures. Deploy it against the official World ID verifier proxy and derive numeric `rpId` from the 16 hexadecimal characters after `rp_`.

Run `forge test` from `libro/contracts` to test the registry contract.

## Libro website embeds

Finalized human and human-authorized-agent publications expose `libro-embed-v1`: a claim-bearing content wrapper plus an adjacent `application/libro+json` manifest. The manifest records the authorship class, exact signal hash, handle hash, unified registry, and transaction. Verification requires the payload handle hash and the handle-bearing registry event to match. Simple publications also display a portable plain-text boundary containing the UTC publication timestamp to minute precision, full signal hash, and public manifest URL. Publication pages include the declaration and offer a copyable, sanitized embed. The same public manifest is available at `/api/publications/{id}/libro-manifest`.

The Chrome Manifest V3 verifier and inline signer live under `libro/chrome-extension`. Build production with `pnpm extension:build`, or build the `https://worldlibro.vercel.app` stage target with `pnpm extension:build:stage`; then load `libro/chrome-extension/dist` or `libro/chrome-extension/dist-stage` as an unpacked extension. Override the target with `VITE_MEMORIOSO_APP_URL` when needed. It scans structured embeds and plain-text Libro tags, and its side panel can capture text, sign as the one author bound to the login session, complete the normal World ID plus sponsored World Chain publishing flow, and safely return the portable tag to the source editor. Existing databases must apply the destructive hard-cutover migration `013_session_bound_handles.sql` after a verified backup.
