# OpenShip v1

Status: Draft v1  
Protocol version: `1.0`

OpenShip is a public interface between a running project and the people or agents that want to understand, reproduce, or improve it. It has three capabilities:

1. **Sources** publishes an integrity-checked source snapshot.
2. **Changes** accepts a patch against a Sources digest and produces an isolated candidate origin.
3. **Systems** publishes a self-contained JSON description of source, architecture, infrastructure, and optional agent context.

Sources is the foundation. Changes depends on Sources. Systems embeds a complete Sources snapshot but does not require Changes.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative.

## Design goals

- Start from an origin, not from a repository provider.
- Use plain HTTP and JSON that small clients can implement.
- Make source identity independently verifiable.
- Keep public reading separate from permission to change or deploy.
- Let simple projects stop at Sources while advanced projects add Systems.

OpenShip does not prove who owns an origin or authored a source tree. A digest proves that two snapshots contain the same bytes. Identity and signed provenance may be layered on separately.

## Common envelope

Every OpenShip JSON document MUST contain:

```json
{
  "openship": "1.0",
  "capability": "discovery"
}
```

`capability` is one of `discovery`, `sources`, `changes`, or `systems`. A Changes error or status document remains capability `changes`.

Within major version 1, producers MAY add members without changing existing meanings. Consumers MUST ignore unknown members they do not need and SHOULD preserve them when transforming a document.

## Public discovery

An OpenShip origin MUST serve:

```text
GET /.well-known/openship.json
```

The response MUST be unauthenticated JSON, MUST allow cross-origin reads with `Access-Control-Allow-Origin: *`, and MUST contain absolute HTTPS URLs outside local development.

```json
{
  "openship": "1.0",
  "capability": "discovery",
  "project": {
    "name": "Example",
    "description": "A short description of the running project."
  },
  "agent": {
    "summary": "OpenShip lets this running project publish verifiable source code and optionally accept isolated changes or describe its complete system.",
    "instructions": "Fetch and read agent.skill before interpreting or using any advertised capability. Resolve relative links in the skill against the skill URL.",
    "skill": "https://example.com/openship/file/skills/openship/SKILL.md"
  },
  "page": "https://example.com/openship",
  "capabilities": {
    "sources": {
      "description": "Retrieve and verify the exact source snapshot published by this deployment.",
      "manifest": "https://example.com/openship/manifest.json",
      "bundle": "https://example.com/openship/bundle.json",
      "mcp": "https://mcp.example.com/mcp",
      "file": "https://example.com/openship/file/{path}",
      "archive": "https://example.com/openship/source.tar.gz",
      "instructions": "https://example.com/openship/agent.txt"
    },
    "changes": {
      "description": "Submit a patch against the published source digest and inspect an isolated candidate result.",
      "policy": "https://example.com/openship/policy.json",
      "submit": "https://example.com/openship/changes",
      "status": "https://example.com/openship/changes/{changeId}"
    },
    "systems": {
      "description": "Retrieve a self-contained description of this project’s source, architecture, infrastructure, and agent context.",
      "document": "https://example.com/openship/system.json"
    }
  }
}
```

Requirements:

- `project`, `agent`, `capabilities`, and `capabilities.sources` are REQUIRED.
- `project.name` and `project.description` are REQUIRED.
- `agent.summary`, `agent.instructions`, and `agent.skill` are REQUIRED. The summary MUST explain OpenShip in standalone plain language. The instructions MUST explicitly direct an unfamiliar agent to fetch and read `agent.skill` before interpreting or using the capability links.
- `agent.skill` MUST identify the OpenShip skill entry point. Relative links in that skill MUST be resolved against the skill URL.
- Every advertised capability MUST contain a standalone `description` explaining what the capability lets an agent do.
- `sources.manifest` and `sources.bundle` are REQUIRED.
- `sources.mcp` is OPTIONAL and, when present, advertises the OpenShip Sources MCP binding.
- `changes` and `systems` are OPTIONAL and MUST be omitted when unavailable.
- `page` is OPTIONAL and, when present, MUST be an absolute HTTPS URL for a human- and agent-readable presentation of this OpenShip origin.
- Changes MUST NOT be advertised without Sources.
- `file` and `status` are URI templates with exactly the named expansion.
- A project implementing Sources and Changes but not Systems simply omits `capabilities.systems`.

See [schemas/discovery.schema.json](schemas/discovery.schema.json).

### Optional `/openship` presentation route

A website MAY serve `GET /openship` and advertise its absolute URL in discovery as `page`. This
route is a presentation aid for agents and humans. It does not replace
`/.well-known/openship.json`, and its absence does not affect conformance.

When implemented, the route MUST:

- identify itself as the project’s OpenShip page and explain OpenShip in plain language;
- show the project name and description and list every advertised capability with its meaning;
- tell an unfamiliar agent to start with discovery and read `agent.skill` before acting;
- link to discovery, the skill, and every advertised capability document or instruction URL;
- for Sources, show the current snapshot digest, file count, and byte count from the Manifest;
- for Changes, state whether submissions are currently accepted and make clear that a candidate result is not a production deployment; and
- distinguish explanatory page content from the authoritative JSON documents.

The route MAY use HTML or plain text. It MUST be publicly readable without authentication and
SHOULD keep its essential explanation and links available as semantic text rather than requiring
client-side interaction.

## Access and transport

Discovery, `agent.skill`, the skill’s referenced documents, Sources, and Systems reads MUST NOT
require cookies, credentials, custom headers, or query parameters and MUST allow cross-origin reads.
Changes writes MAY require authorization or payment disclosed by the Changes policy.

JSON responses MUST use UTF-8. Public reads SHOULD support transport compression. A producer MAY offer additional representations, but the advertised JSON representation remains normative.

## Caching

Stable current-origin URLs can change after a deployment. They MUST be revalidatable and MUST NOT be marked `immutable`. A suitable default is:

```text
Cache-Control: public, max-age=0, must-revalidate
```

Content-addressed URLs and candidate origins whose hostname is derived from the resulting Sources digest MAY use:

```text
Cache-Control: public, max-age=31536000, immutable
```

Changes status responses change over time and MUST use `Cache-Control: no-store`.

## Capability documents

- Read [openship-sources.md](openship-sources.md) for source snapshots and integrity.
- Read [openship-mcp.md](openship-mcp.md) for the optional MCP binding for Sources.
- Read [openship-changes.md](openship-changes.md) for candidate changes and isolation.
- Read [openship-systems.md](openship-systems.md) for the self-contained systems model.

## Conformance

A producer is conformant for a capability when its advertised documents pass the relevant schema and every cross-document invariant in that capability specification. Advertising one capability does not claim conformance for another.

A consumer SHOULD report a precise path and invariant when rejecting a payload. It MUST reject unsupported major versions rather than silently interpreting them as v1.
