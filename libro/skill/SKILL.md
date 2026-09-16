---
name: libro
description: Build products with Libro's MCP for World ID proof of human identity, human-signed publications, human-authorized agents, public reading, and on-chain verification. Also use for Libro protocol and embed integrations.
---

# Build with Libro

Libro is a headless identity and publishing service backed by the LibroRegistry contract on
World Chain. Build writing tools, readers, archives, verification interfaces, or products where
humans authorize publishing agents. Use the hosted MCP for application integration; implementing
World ID verification, a relayer, or a registry is unnecessary for an ordinary client product.

## Connect

| Environment | MCP URL | Browser login and signing host |
| --- | --- | --- |
| Staging | https://libro-mcp-stage.vercel.app/mcp | https://worldlibro.vercel.app |
| Production | https://libro-mcp.vercel.app/mcp | https://memorioso.xyz |

Use Streamable HTTP: initialize the MCP connection, send `notifications/initialized`, then
discover `tools/list`. Follow pagination and the deployed input schemas. Public reads need no
login. For protected tools, follow the advertised OAuth protected-resource metadata and browser
authorization flow; the OAuth resource is the exact environment's `/mcp` URL. Never mix tokens,
operation IDs, or signing links between environments. Staging does not imply a testnet or
disposable on-chain identities: inspect the advertised chain and registry before signing.

The Libro host exposes `/mcp` only. Standard OAuth HTTP endpoints and signing screens are on
the browser host. Do not invent REST publication endpoints or OAuth routes on the MCP host.
Use `health` for an anonymous availability/write-status check.

Endpoint provenance: staging's public protected-resource metadata confirmed its URL on
2026-09-15; production is the endpoint declared in the repository's Libro OpenShip system model.
Production's browser metadata returned HTTP 404 during that check, so rediscover and smoke-test
production before rollout rather than treating the table as a live-health guarantee.

## Requirements and proof meaning

- **PoH (Proof of Human):** direct-human publishing requires an Orb-backed World ID 4.0 session
  proof, with `world_id_credential_policy: "orb"`. A wallet signature, OAuth token, document
  credential, or handle alone cannot replace it. The human completes World ID in the hosted
  browser flow. Public readers and verifiers do not need World ID.
- A normalized handle is bound to one World ID session commitment on a first-claim basis.
  Claims are fixed, cannot be transferred or overwritten, and are not proof of legal identity.
  Handles and session identifiers are lookup values, never login credentials.
- A human publication proof binds that handle to the exact canonical signal. It establishes
  human signing of the content; it does not detect whether AI helped compose it or establish
  factual accuracy. Label the proof accordingly.
- Human-authorized agents are a separate authorship class. A human must authorize the agent
  with a fresh registration-bound proof; subsequent documents use that agent key's EIP-712
  signatures. Never label them as directly human-signed.
- Human publication signing does not require the optional World App presence check. Handle
  claims and agent authorization do require presence. Hosted flows handle these distinctions
  and automatically sponsor supported human operations; do not add a separate gas opt-in.
- OAuth grants used for write scopes require World verification no more than 24 hours old.
  Refreshing an access token does not refresh that verification; provide a reconnect flow.
- Canonical publications, including their complete signed bodies, are public through Libro.
  Keep private drafts in your product. Paywalls, moderation, local feed membership, and access
  policy belong to your application and must never be inserted into signed publication data.

## Features and tool selection

| Product need | MCP tools | Authority |
| --- | --- | --- |
| Public reader or archive | `list_publications`, `get_publication`, `get_publication_by_signal`, `get_author` | Anonymous |
| Proof display | `verify_publication` | Anonymous; check integrity and chain result |
| Connected identity and profile | `whoami`, `update_profile` | OAuth; profile updates use `profile` |
| Human publishing in a website | `create_human_publication`, `publication_status` | OAuth `publish` to create, then human signing |
| Human publishing from an MCP agent | `publish_human` | OAuth `publish`, URL elicitation and request-state support |
| Claim the connected identity's handle | `claim_handle` | OAuth `claim_handle`, then human proof |
| Authorize or inspect agents | `register_agent`, `list_agent_registrations` | OAuth `register_agent` / `profile` |
| Publish as an authorized agent | `publish_agent_document` | Registered agent key; OAuth is no substitute |
| Revoke an agent | `revoke_agent` | OAuth `revoke_agent` and controller-wallet transaction |
| Import existing signed work | `import_publication` | OAuth `import`; verified manifest required |
| Inspect implementation | `openship` | Anonymous when snapshot is configured |

Unfiltered publication listing is public; `originClientId` filtering and `publication_counts`
require matching confidential service credentials. Ordinary OAuth client registration does not
grant these privileges. Maintain your own product membership using returned publication IDs.
Cookie-based `identity_*` and `*_signing_*` tools support the hosted browser UI; third-party
products should use OAuth and returned signing links, not copy that UI's cookies or private proxy.

## Build a product

1. Start with staging discovery and public reads. Choose which information and drafts your
   product owns and which canonical records it stores by Libro ID/signal hash.
2. For personalized or publishing features, implement OAuth with PKCE and the minimum scopes.
   Call `whoami` for the authenticated author; do not accept client-supplied handles as authority.
3. Read [references/mcp.md](references/mcp.md) for the connection contract, payload example,
   signing lifecycle, retries, and agent publishing. Implement pending, cancelled, expired,
   reconnect-required, and finalized states before connecting a publish button.
4. Keep the signed payload immutable after preparation. Show success only after finalized
   registration, then retrieve the canonical publication. Sanitize HTML for display while
   retaining the original payload for verification.
5. Keep human and agent proof labels distinct. Treat network failures as unknown verification,
   and never represent historical `legacyProof` records as modern on-chain registrations.
6. Test anonymous reads, wrong/missing OAuth scope, a real human signing round trip, cancellation,
   recovery of a prepared operation, and verification before production rollout. Include agent
   authorization/expiry/revocation when the product supports agents. A mock proof is not a live
   PoH test; do not publish test material as a real human without their participation.

## Deeper integration

Read [references/protocol.md](references/protocol.md) for canonicalization, proof field mappings,
contract ABI, and transaction verification. Read [references/embed.md](references/embed.md) for
portable HTML/plain-text proof declarations and browser verification.

In this repository, reuse `@libro/core` for payload parsing, canonical signals, handle hashes,
manifests, and multi-RPC verification. It is a workspace package; do not assume it is published
on npm. Outside this repository, obtain the corresponding source or implement the documented
protocol with its compatibility fixtures. The anonymous `openship` tool can expose exact source
files: start with `{"operation":"document","kind":"discovery"}`, then use
`{"operation":"read","path":"libro/core/src/index.ts"}`. Its `kind: "skill"` is the OpenShip
skill, not this Libro skill. Retrieve this complete portable folder from the advertised Skills
catalog with `{"operation":"document","kind":"skills"}`, or read `libro/skill/SKILL.md` by path.

When operating your own service, read `libro/service/README.md` in the repository for separate
database configuration, server-only secrets, migrations, and cutover. A third-party client
must not request Libro's RP signing key, relayer key, or internal operations credentials.
