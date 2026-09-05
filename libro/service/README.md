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

The service reads `DATABASE_URL` lazily (`LIBRO_DATABASE_URL` is the copy target), so a production
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

## P1 cutover prerequisites

Run Memorioso migrations through **022** before deploying the updated client or extension. Keep
canonical writes and payment settlements paused while applying 020–022; do not deploy 020 alone.
021 backfills policies created since 020 and installs a trigger that keeps legacy publication
inserts and access/price updates synchronized throughout the shadow-copy period. Existing
migration checksums are unchanged. A fresh `db:init` includes these changes.

OAuth now requires explicit consent for each authorization request. Sign in again to grant the
new `revoke_agent` scope. Login selects an existing session by handle and requires a fresh World
proof bound to that identity; possession of the handle or session identifier never authenticates.
The service signing widgets request user presence. Keep the original World RP and session bindings
when moving existing identities.

Ship the updated extension before removing `WORLD_ID_RP_SIGNING_KEY` from Memorioso. Its **Connect
with Libro** button opens browser OAuth, then asks the user to approve the extension. A separate,
short-lived polling secret delivers the extension token; no OAuth tokens are returned to the
extension. **Renew Libro authorization** restarts that flow when the write grant ages out. Old
extension proof-login clients must upgrade. `SESSION_SECRET` also protects extension connection
consent and token derivation; keep it configured on Memorioso.

The existing author panel lists and revokes service-managed agents through authenticated service
proxies. MCP exposes `revoke_agent`; callers broadcast its prepared transaction using the
registered controller wallet and supply the receipt for finalization. A matching on-chain
`AgentRevoked` event is required before recording revocation locally.

Prepared human publications remain recoverable after the initial five-minute signing window.
Reopen the signing link and press **Sign with World ID** to resume its stored transaction instead
of creating another proof. World wallet operation hashes are saved before polling. New, unprepared
challenges still expire normally. Successful finalization and its handle claim commit together.

## Regression verification

`pnpm test`, `pnpm --filter @libro/service test`, and extension tests cover the client and service.
Set `LIBRO_TEST_DATABASE_URL` to an explicit test Postgres database to also run the integration
suites; each creates and removes its own schema and mocks external World/chain verification.
Without that variable, database tests are skipped. CI supplies Postgres and runs them. These tests
do not replace a staging run with a real World proof and wallet transaction.

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
