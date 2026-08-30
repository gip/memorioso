# Libro service

`libro/service` is the authoritative identity and publishing service. It owns canonical authors,
handle/session bindings, human and agent publication workflows, OAuth, MCP, the publication
database, the durable event outbox, chain verification, and the Libro relayer. Memorioso remains a
client with drafts, local author projections, access policy, feeds, and presentation.

## Local setup

Use a database distinct from Memorioso:

```sh
DATABASE_URL_UNPOOLED=postgresql://postgres:postgres@localhost:5432/libro \
  pnpm --filter @libro/service db:migrate
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/libro \
  pnpm --filter @libro/service dev
```

The service reads `LIBRO_DATABASE_URL` (falling back to `DATABASE_URL`) lazily, so a production
build does not require database access. It also needs the shared World RP configuration, registry
configuration, `LIBRO_SERVICE_URL`, `LIBRO_MCP_STATE_SECRET`, and
`LIBRO_SIGNING_CAPABILITY_SECRET`. Only the service deployment receives
`WORLD_ID_RP_SIGNING_KEY` and `LIBRO_RELAYER_PRIVATE_KEY` after cutover.

`OPENSHIP_SOURCE_ORIGIN` enables the MCP's public `openship` tool. It exposes only that origin's
validated Sources manifest and exact files through `manifest` and `read` operations; callers cannot
select another origin, retrieve an unverified bundle, or use OpenShip Changes through MCP.

OAuth access tokens are opaque and valid for 15 minutes; rotating refresh tokens and grants expire
after seven days. A grant used for a write scope must be based on World verification no more than 24
hours old. Client metadata documents are preferred, pre-registration is supported for Memorioso,
and dynamic registration is a compatibility fallback. Neither discovered nor dynamically
registered clients receive a trusted author-reference namespace.

## Cutover and rollback

1. Deploy with `LIBRO_SERVICE_WRITES_ENABLED=0`, run an initial idempotent copy, and shadow-compare
   every read surface.
2. Put identity/profile/handle/publication and agent writes into maintenance mode while leaving
   draft editing and encryption available. Stop issuing RP contexts and drain challenges and
   indeterminate relays.
3. Set `SOURCE_DATABASE_URL` and `LIBRO_DATABASE_URL`, then run `pnpm libro:migrate` from a
   consistent source snapshot. Validate its counts, IDs, signal hashes, mappings, agent records,
   and sequences. Add `--link-source-identities` only after the target validation succeeds.
4. In one release, switch Memorioso reads and human publishing to Libro, disable every legacy
   chain-facing route, remove `LIBRO_RELAYER_PRIVATE_KEY` from Memorioso, then enable Libro writes.
5. Smoke-test OAuth login, handle claim, human and agent publication, MCP, webhook acknowledgement,
   local-only feeds, and multi-RPC verification before reopening writes.

Before Libro accepts a write, rollback is a configuration reversal. After it accepts a write,
never simply point traffic back at Memorioso: freeze writes again, perform an audited reverse copy,
validate all invariants and sequences, then reverse the flags. Keep the retired chain-facing tables
read-only for 30 days.

Memorioso gating is presentation policy, not content confidentiality. Libro public APIs and MCP
return the complete canonical signed payload, including bodies that Memorioso presents behind a
World ID or x402 gate.
