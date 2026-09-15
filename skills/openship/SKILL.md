---
name: openship
description: Work with OpenShip v1 discovery, public source snapshots, candidate code changes, self-contained system descriptions, and portable Markdown skills. Use when implementing, consuming, validating, or explaining an OpenShip capability; do not use for unrelated repository or deployment work.
---

# OpenShip

OpenShip lets a running project publish the source that produced it, optionally accept changes as isolated candidate versions, and optionally describe the complete software system around that source through ordered design layers and separate instance bindings. Systems 2.0 replaces the legacy single graph; Sources and Changes retain their 1.0 formats.

Read only the references needed for the task:

- For the protocol overview, discovery, shared conventions, or capability selection, read [references/openship.md](references/openship.md).
- For publishing, retrieving, or validating a source snapshot, read [references/openship-sources.md](references/openship-sources.md).
- For exposing or consuming Sources through MCP, also read [references/openship-mcp.md](references/openship-mcp.md).
- For proposing or serving candidate code versions, read both [references/openship-sources.md](references/openship-sources.md) and [references/openship-changes.md](references/openship-changes.md).
- For authoring or consuming a self-contained architecture and source payload, read both [references/openship-sources.md](references/openship-sources.md) and [references/openship-systems.md](references/openship-systems.md).

- For publishing, importing, or sharing optional product skills, read [references/openship-skills.md](references/openship-skills.md). Skills are Markdown folders; the catalog transports their exact files.

Machine-readable schemas and conformance examples are under [references/schemas](references/schemas) and [references/examples](references/examples). Treat the Markdown specifications as normative when a constraint cannot be expressed by JSON Schema.
