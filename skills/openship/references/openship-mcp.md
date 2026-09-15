# OpenShip public MCP tool binding

Status: Draft; full-document binding `1.0`. The OpenShip envelope remains `1.0`.

## One public tool

An MCP producer registers exactly one OpenShip application tool named `openship`.
MCP initialization and this tool MUST work without authentication. Other tools may
require authentication, but those requirements MUST NOT block OpenShip reads.
Consumers need no HTTP discovery, website, MCP resources, or other application tools.
Use Streamable HTTP; local processes and legacy HTTP+SSE endpoints are outside this binding.

## Operations and results

All results MUST provide `structuredContent` and a `content` text block containing
its JSON equivalent. Tool failures use `isError: true` without source content.

| Arguments                                          | Structured result                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `{ "operation": "document", "kind": "discovery" }` | `{ "document": <MCP discovery> }`                                                                                  |
| `{ "operation": "manifest" }`                      | `{ "origin": <configured origin or MCP endpoint>, "manifest": <Sources Manifest> }`                                |
| `{ "operation": "document", "kind": "bundle" }`    | `{ "document": <Sources Bundle> }`                                                                                 |
| `{ "operation": "document", "kind": "systems" }`   | `{ "document": <Systems document> }`                                                                               |
| `{ "operation": "document", "kind": "policy" }`    | `{ "document": <Changes policy> }`                                                                                 |
| `{ "operation": "document", "kind": "skill" }`     | `{ "document": <skill Markdown string> }`                                                                          |
| `{ "operation": "read", "path": "app/page.tsx" }`  | `{ "digest": <snapshot digest>, "metadata": <Manifest entry>, "encoding": <encoding>, "content": <file content> }` |

Discovery, Manifest, Bundle, skill, and exact-path file reads are required.
An advertised Skills catalog requires `{ "operation": "document", "kind": "skills" }`, returning `{ "document": <complete Skills catalog> }`. Skills contain Markdown files plus optional supporting files; singular `skill` remains the protocol Markdown. See [Skills](openship-skills.md).
Systems and Changes policy are required only when advertised. `manifest` and `read`
preserve the earlier Sources binding; `document` adds complete project retrieval.
Old source-only producers must adopt this profile to load in the OpenShip viewer.

## MCP discovery profile

Use [mcp-discovery.schema.json](schemas/mcp-discovery.schema.json) and the
[complete example](examples/valid/mcp-discovery.json). Set `mcpBinding: "1.0"`.
Project metadata and capability descriptions have the same requirements as HTTP discovery.
The following fields contain exact tool arguments, not URLs or MCP resource identifiers:

- `agent.skill`: `{ "operation": "document", "kind": "skill" }`
- `capabilities.sources.manifest`: `{ "operation": "manifest" }`
- `capabilities.sources.bundle`: `{ "operation": "document", "kind": "bundle" }`
- Optional `capabilities.skills.document`: `{ "operation": "document", "kind": "skills" }`
- Optional `capabilities.systems.document`: `{ "operation": "document", "kind": "systems" }`
- Optional `capabilities.changes.policy`: `{ "operation": "document", "kind": "policy" }`

Omit unavailable optional capabilities. Changes here advertises policy only; submit
and status are not part of this read-only profile. Informational HTTPS links are
permitted but consumers MUST NOT depend on them to retrieve OpenShip documents.
The HTTP discovery schema remains unchanged. A website may still advertise an MCP
endpoint through `capabilities.sources.mcp`.

## Integrity

Every document MUST describe the same published snapshot. Validate the Manifest and
Bundle bytes before returning content. Systems' embedded Sources MUST match the
standalone Sources digest. Consumers validate all schemas, file sizes, digests,
encodings, and safe paths before displaying or saving a snapshot. If publication
changes mid-read, fail and let the consumer retry; never mix snapshots.

`read` accepts only exact safe Manifest paths, never arbitrary URLs or filesystem paths.
UTF-8 files return text; binary files return canonical base64. A failed refresh MUST
NOT replace the last complete valid saved snapshot. Consumers may enforce size and
time limits and reject private addresses or endpoint redirects.

## Publishing and consuming

Register `openship` with a discriminated input union for the operations above, and
serve each response from one validated in-memory snapshot. Do not protect protocol
initialization or this tool with endpoint-wide authentication middleware. Enforce
authentication separately for unrelated tools. Resource registration is unnecessary.

In OpenShip, choose **MCP**, enter the complete public HTTPS endpoint, and open the
project. Sign in to enable saved source snapshots using the same rules as websites.
The full endpoint path and query identify the MCP project; two endpoints on one host
can represent different projects. No access tokens should be included in the URL.
