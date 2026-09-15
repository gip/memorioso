# Libro MCP integration

## Transport and OAuth

Use a Streamable HTTP MCP client with JSON and SSE response support. Negotiate the protocol
version and preserve any returned session ID. Discover tool schemas with `tools/list` rather
than assuming this reference is exhaustive. Calls use the standard envelope, for example:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_publications","arguments":{"limit":20,"offset":0,"kind":"all"}}}
```

`kind` accepts `article`, `short`, or `all`; `limit` is 1–100. `authorId` is an optional UUID.
Use `get_author({idOrHandle})`, `get_publication({publicationId})`, or
`get_publication_by_signal({signalHash})` to fetch a record. Publication IDs are strings.

The repository's `libro/core/src/mcp-client.ts` implements the website client's subset:
initialization, JSON/SSE decoding, and tool errors. It supports protocol `2025-06-18` and does
not implement OAuth, tool discovery, or URL elicitation. Use a full MCP client for agent-oriented
`publish_human`, `claim_handle`, and `register_agent` continuations, or use the explicit website
publishing flow below. Do not treat `inputRequired` as a completed tool result.

For OAuth:

1. Follow the resource metadata URL advertised by MCP's auth challenge (including
   `mcp/www_authenticate` in tool errors). Its `resource` must match the chosen MCP URL.
2. Discover the authorization server. Browser hosts serve
   `/.well-known/oauth-protected-resource/libro` and
   `/.well-known/oauth-authorization-server/libro`; the issuer ends in `/libro`.
3. Use supported client metadata discovery or registration. Client metadata documents are
   preferred; dynamic registration is a compatibility fallback. Neither confers a trusted
   author-reference namespace. Do not invent confidential service credentials.
4. Use authorization-code OAuth with PKCE S256, bound state, exact redirect URI, resource, and
   minimum scopes. Standard token/register/revoke HTTP endpoints are advertised on the browser
   host under `/api/libro/oauth/`. The human authenticates in the hosted flow; connection then
   completes automatically without a separate application consent screen.
5. Send `Authorization: Bearer <access_token>` to protected MCP tools. Keep confidential client
   secrets and server-app tokens server-side; never expose them in public configuration, URLs,
   or logs. Public OAuth clients use their supported PKCE flow without a fabricated secret.

Scopes: `openid`, `profile`, `publish`, `claim_handle`, `register_agent`, `import`, `revoke_agent`.
Access tokens last 15 minutes; rotating refresh tokens and grants expire after seven days.
Write scopes (`publish`, `claim_handle`, `register_agent`, `import`, `revoke_agent`) require World
verification within 24 hours. Renew through browser authorization when that age limit is reached.
Store rotated refresh tokens atomically and avoid concurrent refresh races.

## Human publication in a product

Call `whoami({})` after OAuth. It returns `identityId`, `authorId`, `handle`, `name`, `bio`,
`authorReference`, and `scopes`. Build a v2 payload using these author values. For example, in
this workspace:

```ts
import { hashLibroHandle, parseLibroPublication } from '@libro/core'

const publication = parseLibroPublication({
  publication_schema: 'libro-publication-v2',
  libro_protocol_version: 'libro-v1',
  world_id_protocol_version: '4.0',
  world_id_proof_type: 'session',
  world_id_credential_policy: 'orb',
  publication_date: new Date().toISOString(),
  author_name_libro: me.name,
  author_handle_libro: me.handle,
  author_handle_hash_libro: hashLibroHandle(me.handle),
  author_bio_libro: me.bio ?? '',
  publication_title: title.trim(),
  publication_subtitle: subtitle.trim(),
  publication_content: { html },
})
```

Here `me` is the authenticated `whoami` result and `title`, `subtitle`, and `html` are the
author's current draft strings. `author_reference` is optional; omit it unless needed, or copy
the exact `authorReference` from `whoami`. Never synthesize a namespace. V2 has no
`author_id_libro`. Title and subtitle are strings (possibly empty), and either a nonempty title
or readable body text is required. The date must be no later than the server's current time
and no older than five minutes when creating a challenge; account for client clock skew.

1. Call `create_human_publication({publication, clientReference})` with OAuth `publish`.
   Use a stable product operation ID as `clientReference` (1–256 characters) and persist the
   exact payload. The response contains `challengeId`, `signalHash`, `signingUrl`, and `existing`.
2. Save that response. Open the returned signing URL for the human; keep the capability URL out
   of analytics and public logs. The hosted UI handles review, World ID, any first handle claim,
   sponsored transaction submission, and finalization.
3. Poll `publication_status({challengeId})` with the same OAuth identity and client using bounded
   backoff. States are `awaiting_signature`, `prepared`, `expired`, and `finalized`; the result
   includes nullable `registrationId`, `transactionHash`, and `publicationId`.
4. Stop foreground polling on cancellation or navigation and offer resume. `prepared` is
   recoverable past the initial five-minute window: reopen the stored signing URL to resume
   its transaction. Do not create another proof or broadcast a second transaction.
5. On `finalized`, fetch `get_publication({publicationId})` and attach that ID to your product's
   feed or document. A transaction hash or completed browser redirect alone is not success.

For MCP agent clients, `publish_human({publication, clientReference})` initiates URL elicitation.
Let the human complete the supplied URL, then resume using the MCP request-state mechanism
with unchanged arguments and the same identity/client. Preserve the server-issued opaque
request state; it is not an extra tool argument. The continuation validates the argument digest
and subject and returns finalized status or further `inputRequired`.

### Errors and retries

Check `isError` even after HTTP 200. Parse `structuredContent` when present or JSON text content;
tool errors carry `error.code`, `message`, `status`, and `retryable`. Treat transport errors,
auth errors, pending human input, and tool failures as separate states.

Never automatically repeat a mutation after a timeout: it may have committed. Read saved
operation status first. Reusing a `clientReference` with a different canonical signal returns
`IDEMPOTENCY_CONFLICT`. Challenge creation validates the date before looking up a reused
reference, so resubmitting an old payload is not a recovery mechanism after five minutes.
Use the saved challenge/signing link instead. Create a fresh operation only after resolving the
previous operation's outcome; changed content requires a new payload and human signature.

## Human-authorized agents

1. Obtain OAuth `register_agent`. Call
   `register_agent({controllerAddress, agentAddress, expiresAt})`, where `expiresAt` is an ISO
   datetime and the controller wallet is controlled by the human. Complete URL elicitation and
   resume the request state until finalized. Registration requires a fresh human proof with
   presence, bound to the exact authorization.
2. Inspect `list_agent_registrations({})` with `profile` scope for registration hash, addresses,
   scope, validity, expiry, and revocation. Keep the agent private key in an appropriate secret
   store, and check that the registration permits the intended operation.
3. Build a `libro-agent-publication-v2` payload and sign the exact EIP-712 `AgentDocument` typed
   data with the registered agent key. Call `publish_agent_document` with `stage: "prepare"`,
   `publication`, a 32-byte hex `documentNonce`, Unix-seconds integer `signedAt`, and `signature`.
4. Broadcast the returned prepared transaction. Finalize with `stage: "finalize"`,
   `documentRegistrationId`, `transactionHash`, optional `userOpHash`, and a fresh `signedAt`
   and `AgentDocumentFinalization` signature bound to that transaction hash. The registration
   ID alone grants no authority. OAuth cannot substitute for either signature.
5. Revoke with `revoke_agent({registrationId})` using OAuth `revoke_agent`; broadcast the prepared
   transaction from the registered controller wallet and call again with `transactionHash`.
   Record success only after a matching on-chain `AgentRevoked` event is confirmed.

Use `createLibroAgentDocumentTypedData` and `createLibroAgentDocumentFinalizationTypedData`
from `@libro/core` when available. Agent v2 payloads use `libro_agent_protocol_version`,
`authorship_claim: "human_authorized_agent"`, `agent_address`, and `agent_registration_hash`
alongside the author and publication fields; they do not reuse the human World ID fields.
Do not guess typed-data domains, field order, expiry limits, or nonce rules.
Read the deployed sources `libro/service/lib/agent-documents.ts`,
`libro/service/lib/agent-registrations.ts`, and `libro/core/src/index.ts` (via OpenShip if needed)
and their helpers for the exact signing contract. Human-operation gas sponsorship is not a
promise that an external agent's transaction sender has gas.

## Verification and product boundaries

Call `verify_publication({publicationId})` for canonical hash comparison and chain verification.
Inspect `canonicalPayloadMatches`, `verifiedBy`, and `rpcOutcomes`; HTTP success alone is
insufficient. Independent verifiers must recompute the signal and handle hashes, validate the
approved chain/registry, and confirm the matching handle-bound registration. Query configured
RPCs in parallel: one matching event suffices; a pruned receipt or unavailable RPC does not
establish invalidity. The protocol and embed references specify the full binding.

Use `import_publication({manifest, clientReference?})` with `import` scope for existing signed
work. It validates local integrity and on-chain registration; it does not re-sign altered prose.
Keep the original signed data separate from sanitized display HTML and application-only policy.
Private drafts, subscriptions, search, local feed membership, and payment/access controls are
product responsibilities. Libro's public canonical body cannot be made confidential by a client
paywall.
