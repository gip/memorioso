# Libro service

`libro/service` is the headless MCP, identity, and publishing service. It has no frontend. It owns canonical authors,
handle/session bindings, human and agent publication workflows, OAuth state and verification, MCP, the publication
database, the durable event outbox, chain verification, and the Libro relayer. Memorioso remains a
client with drafts, local author projections, access policy, feeds, and all browser presentation.

Login, handle selection, OAuth connection, human signing, handle claims, and agent authorization live
under Memorioso's `/libro/` routes. The login screen reuses the same `WorldIdLoginDialog` as legacy
Memorioso. OAuth discovery and signing URLs point to `NEXT_PUBLIC_APP_URL`, which must be
configured to the Memorioso origin on both deployments. `LIBRO_SERVICE_URL` is exclusively the
MCP backend origin. The OAuth issuer is the Memorioso origin followed by `/libro`.

Memorioso's `/api/libro/browser/` proxy allows only named browser MCP tools and OAuth authorization needed by these screens.
It forwards only Libro browser cookies, scopes returned cookies to that path, and checks the
Memorioso Origin on mutations. It never forwards the Memorioso session or OAuth bearer tokens.
Libro still verifies World proofs and owns authorization, identity binding, and canonical writes.
Deploy the updated app and service together. Old service-hosted signing redirects are removed.
Recover an older signing link by opening the same capability at Memorioso's `/libro/sign/`,
`/libro/sign-agent/`, or `/libro/claim/` URL; the stored prepared operation remains intact.

## MCP-only application interface

The only application route on Libro is `/mcp`. There are no REST, OAuth, metadata, health,
root-discovery, or redirect routes on that host. A regression test enforces this boundary.
Memorioso's server uses MCP for publications, profile updates, agent management, and human
publication challenges. Browser and mobile screens use MCP through `/api/libro/browser/mcp`
for identity verification, signing review, proof preparation, relaying, finalization, and wallet
receipts. The proxy allowlists tool names, checks Origin, and forwards only Libro cookies.
It never forwards Memorioso credentials or lets a browser invoke service operations or token exchange.
Browser OAuth uses the allowlisted `oauth_authorization_context` and `oauth_authorize` tools.
MCP tool errors retain their codes, status, and retryability; a tool failure is not an HTTP
transport failure. The client initializes MCP and accepts JSON or SSE responses, without
retrying mutations automatically.

`get_publication`, `get_publication_by_signal`, `get_author`, and unfiltered `list_publications`
are public. Supplying `originClientId` to `list_publications`, or calling `publication_counts`,
requires the matching confidential service credentials.
`whoami`, `update_profile`, `create_human_publication`, `publication_status`, and agent
management preserve OAuth identity and scope checks. Existing agent-oriented elicitation tools
remain available; website clients use `create_human_publication` to manage signing UI themselves.
Cookie-based browser tools require the Libro Origin; public handle and receipt lookups do not.
Signing tools retain session/capability ownership
checks. Cookie changes from identity verification are attached to the completed MCP response.

Standard OAuth endpoints live exclusively on Memorioso:

- `/.well-known/oauth-authorization-server/libro` advertises the `/libro` issuer.
- `/.well-known/oauth-protected-resource/libro` identifies Libro's `/mcp` resource.
- `/libro/authorize` hosts the existing browser authorization screen.
- `/api/libro/oauth/token`, `/register`, and `/revoke` translate standard OAuth requests to
  `oauth_token`, `oauth_register`, and `oauth_revoke` MCP calls. They forward client authentication
  but never website cookies or confidential Memorioso service credentials. Libro still validates
  PKCE, client secrets, resources, scopes, token rotation, and revocation and owns the database.

MCP responses and authentication challenges advertise the protected-resource metadata on
Memorioso. Memorioso's own server uses the same MCP tools directly, including refresh and
sign-out revocation; it does not call a separate Libro HTTP endpoint.

Health checks call the anonymous `health` MCP tool. Scheduled event delivery calls `deliver_events`
over MCP with `Authorization: Internal <LIBRO_INTERNAL_CRON_SECRET>`. Keep the credential in the
transport header, never in tool arguments. It cannot authenticate as a user, and user OAuth tokens
cannot trigger event delivery. Update existing health monitors and event-delivery jobs to call
these tools; their old HTTP URLs no longer exist.

The service-backed initial reading feed fetches at request time, outside its shared cache. Building Memorioso does not require the currently deployed Libro instance to
already expose the next client’s tools. Deploy the current Libro service before enabling
production traffic to the updated website; request-time reads still require compatible tools.

Deploy Memorioso and Libro together. Apply Libro migration **003** and set
`LIBRO_OAUTH_RESOURCE` to the absolute Libro `/mcp` URL. The migration changes pre-registered
confidential clients to that resource and revokes tokens, grants, and codes issued for the old
API audience. Existing website users must sign in again to connect to the MCP resource;
existing `/mcp` grants are unaffected. Prepared signing operations remain recoverable after
sign-in. MCP clients that cached the former Libro OAuth issuer must rediscover or reconnect
using the new Memorioso issuer. Update external REST consumers and operational monitors to MCP
before deploying this breaking change.

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
validated snapshot through the OpenShip 0.2.1 full-document MCP binding. `document` retrieves
MCP discovery, the complete verified bundle, the skill, or advertised Systems; `manifest` and
`read` retrieve metadata and exact files. Results include structured content and equivalent JSON
text. MCP discovery summaries and Systems describe only Libro MCP and its dependencies. The
source manifest and bundle retain the upstream repository scope, which may include Memorioso
and other components outside the MCP system. Systems is composed from
`libro/service/lib/openship-system.json` in the verified snapshot, never from the upstream
website system view. The system model and skill both come from verified snapshot bytes.
Changes policy is not advertised. Callers cannot select another origin. Initialization and
OpenShip reads are public; unrelated write tools retain their OAuth requirements.

OAuth access tokens are opaque and valid for 15 minutes; rotating refresh tokens and grants expire
after seven days. A grant used for a write scope must be based on World verification no more than 24
hours old. Client metadata documents are preferred, pre-registration is supported for Memorioso,
and dynamic registration is a compatibility fallback. Neither discovered nor dynamically
registered clients receive a trusted author-reference namespace.

Human v2 publications may omit `author_reference`. When supplying it, use the exact
`authorReference` returned by MCP `whoami`; other namespaces or author IDs are rejected.
For Memorioso, `LIBRO_AUTHOR_NAMESPACE` must equal the `NEXT_PUBLIC_APP_URL` origin,
without a path or trailing slash. The copy command validates this before database access.
Older configuration examples used `https://memorioso.xyz/authors`, which cannot match a
canonical publication reference. If that value was already seeded, correct the environment
and the pre-registered client's `libro_oauth_clients.author_namespace` in the Libro database
to `https://memorioso.xyz` after verifying its client ID and deployment origin. Do not rerun
the data copy after cutover to repair this setting, or rewrite existing signed payloads.

## P1 cutover prerequisites

For databases containing historical World ID publications, also apply Memorioso migration **023**
and Libro migration **002** before copying. The copy preserves the original IDs, signed JSON and
proof JSON. Historical records are explicitly marked `legacyProof`; their derived signal hash is
a lookup fingerprint, not evidence of a Libro registration. Historical author profiles without
World ID 4 session bindings have a null identity and cannot authenticate. Libro's chain verification
and manifest paths reject these records instead of representing them as modern on-chain proofs.
The final `--link-source-identities` step installs local access policies for historical publications
and marks copied author projections as service-managed. Feeds and counts retain them.

Run Memorioso migrations through **022** before deploying the updated client or extension. Keep
canonical writes and payment settlements paused while applying 020–022; do not deploy 020 alone.
021 backfills policies created since 020 and installs a trigger that keeps legacy publication
inserts and access/price updates synchronized throughout the shadow-copy period. Existing
migration checksums are unchanged. A fresh `db:init` includes these changes.

OAuth connects automatically after authentication, without an application approval screen.
Request binding, origin, PKCE, redirect URI, and scope validation still apply. Login selects an existing session by handle and requires a fresh World
proof bound to that identity; possession of the handle or session identifier never authenticates.
Publication signing uses a fresh, signal-bound Proof of Human session proof without requiring the
optional World App presence check, matching the draft publisher. Handle claims and agent authorization
still request user presence. Keep the original World RP and session bindings
when moving existing identities.

Gas sponsorship is automatic for publications, handle claims, and agent authorization. Memorioso
uses World App sponsorship when available and otherwise submits the prepared transaction to the
Libro relayer. No separate sponsorship proof or gas opt-in is required; the action's World ID proof
and identity-bound signing capability still authorize it. Libro needs its funded
`LIBRO_RELAYER_PRIVATE_KEY` for this path.

Ship the updated extension before removing `WORLD_ID_RP_SIGNING_KEY` from Memorioso. Its **Connect
with Libro** button opens browser OAuth, then automatically connects the extension. A separate,
short-lived polling secret delivers the extension token; no OAuth tokens are returned to the
extension. **Renew Libro authorization** restarts that flow when the write grant ages out. Old
extension proof-login clients must upgrade. `SESSION_SECRET` also protects extension connection
request binding and token derivation; keep it configured on Memorioso.

The existing author panel lists and revokes service-managed agents through authenticated service
proxies. MCP exposes `revoke_agent`; callers broadcast its prepared transaction using the
registered controller wallet and supply the receipt for finalization. A matching on-chain
`AgentRevoked` event is required before recording revocation locally.

Prepared human publications remain recoverable after the initial five-minute signing window.
Opening the signing link starts signing automatically, or resumes its stored transaction instead
of creating another proof. The draft publish action opens World ID directly without a second start
button. A retry button appears only after a failure or cancellation. World wallet operation hashes
are saved before polling. New, unprepared challenges still expire normally. Successful finalization
and its handle claim commit together.

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

Memorioso gating is presentation policy, not content confidentiality. Libro public MCP tools
return the complete canonical signed payload, including bodies that Memorioso presents behind a
World ID or x402 gate.
