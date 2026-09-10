# OpenShip Systems 2.0

Systems publishes one JSON document containing a complete Sources snapshot, ordered design layers, explicit implementation mappings, optional instance descriptions, and shared context. Systems 2.0 replaces the previous single-graph format; legacy Systems documents are unsupported. Sources and Changes remain OpenShip 1.0.

## Envelope and system

```json
{
  "openship": "1.0",
  "capability": "systems",
  "systemsVersion": "2.0",
  "source": { "manifest": {}, "bundle": {} },
  "system": {
    "id": "example",
    "name": "Example",
    "layers": [],
    "refinements": [],
    "instances": []
  }
}
```

This illustrates the envelope only: `source.manifest` and `source.bundle` MUST be valid, complete Sources, and `layers` MUST contain at least one layer. See [the complete layered example](examples/valid/systems-layered.json) and [the schema](schemas/systems.schema.json).

The old `system.nodes`, `system.edges`, and `system.rootNodeId` members are forbidden. Metadata and unrecognized extension members MUST be preserved. Self-containment covers the design and source bytes; external secret and runtime-state references need not resolve within the document. Consumers MUST NOT interpret validation as proof of deployment or runtime health.

## Ordered design layers

Each layer has `id`, `name`, `role`, `rootNodeId`, `nodes`, and `edges`. Array order runs from abstract to concrete. Layer IDs MUST be unique. Roles are `logical`, `technical`, `provider`, or `custom`; roles MAY repeat and standard roles MAY be omitted.

| Recommended role | Decisions represented |
|---|---|
| logical | Responsibilities, contracts, logical entities and invariants, required initial data. |
| technical | Frameworks, runtimes, database engines, schemas, migrations and seed scripts. |
| provider | Hosting providers, intended regions, resources and deployment settings. |

Any positive number of layers is supported. Each is an explicit graph, not a generated projection or an inherited configuration overlay. Alternative branches are not defined in this version.

## Nodes, containment and sources

Node kinds are `Root`, `Block`, `Store`, `Host`, `Container`, `Process`, and `Library`. Block describes a capability; Store describes persistent data. The other kinds describe a system boundary, execution environment, grouped runtime, executable component, and reusable dependency respectively.

```json
{
  "id": "technical.database",
  "kind": "Store",
  "name": "PostgreSQL database",
  "parentId": "technical.root",
  "metadata": { "ownership": "first_party" },
  "sourceSelectors": ["db/**"],
  "configuration": [
    { "name": "engine", "description": "Database engine", "required": true, "value": "PostgreSQL" }
  ]
}
```

- Node IDs MUST be globally unique across all layers. IDs match `^[A-Za-z0-9._:-]+$`.
- Each layer MUST have exactly one parentless Root identified by its `rootNodeId`. Every other node, including Library, MUST have a parent in the same layer. Containment MUST be acyclic; no kind-specific parent restrictions apply.
- Every node MUST declare `metadata.ownership`: `first_party` means publisher-controlled implementation or operation; `third_party` means external control.
- Optional source selectors select an exact Manifest path or a directory ending in `/**`. No other wildcards are supported. Every selector MUST match at least one Manifest path. Sharing selected paths is allowed.

## Connections and refinements

Layer-local edges have `id`, `type`, `fromNodeId`, `toNodeId`, and optional metadata. IDs MUST be unique within their layer. Endpoints MUST be non-root nodes in that layer. Types are Runtime (cycles allowed), Dataflow (acyclic), and Dependency (acyclic). Endpoint kinds do not constrain the connection type.

Refinements have `id`, `fromNodeId`, and `toNodeId`. IDs MUST be unique within `system.refinements`. The source MUST belong to a later layer than the target. Thus the concrete source implements the more abstract target. Many-to-many mappings, skipped layers, and root mappings are allowed. Refinements neither imply containment nor copy configuration, documents, or runtime edges.

## Domains (optional)

`system.domains` MAY declare an ordered list of domains. A domain groups blocks independently of layers, containment, and refinement. Each requires a unique `id`, a nonempty `name`, and `nodeIds`; an optional nonempty `description` explains its scope. Domain IDs use the standard ID grammar. Member IDs MUST be unique within the domain and MUST reference existing nodes anywhere in the system.

```json
"domains": [
  { "id": "web", "name": "Web app", "nodeIds": ["logical.web", "technical.web"] },
  { "id": "state", "name": "State", "nodeIds": ["technical.web", "technical.database"] }
]
```

A node MAY belong to zero, one, or multiple domains. Empty domains and an empty domain list are valid. Membership is explicit and is not inherited through parents or refinements. Omitting domains preserves the existing Systems behavior.

Viewers SHOULD select all domains initially. When filtering, a node matches if it has no domain or belongs to any selected domain. Keep the layer root and ancestors needed to render matching nodes as structural boundaries; this does not make other children visible. Hide connections whose endpoints do not match. Domain filters are presentation controls, not access controls. Keep domain selections across layer changes.

Domains are an additive capability in package 0.1.1. The envelope remains `openship: "1.0"` and `systemsVersion: "2.0"`.

## Configuration

Nodes and instance bindings MAY contain a `configuration` array. Each entry requires a unique `name`, a nonempty `description`, and a boolean `required` flag. Optional `value` contains JSON data; its absence means unresolved, whereas an explicit null is a supplied value.

A sensitive entry uses `sensitive: true` and MUST NOT contain a literal value. An optional `secretRef` is `{ "nodeId": "provider.app", "key": "DATABASE_URL" }`; its node MUST exist and scopes the external key to a component. Any entry with `secretRef` MUST NOT also contain `value`. A secret reference is descriptive: validation does not resolve it or require the external key to exist. Producers MUST classify credentials as sensitive and MUST NOT publish credential values elsewhere in metadata or context.

## Instances and database state

Instances are separate from design layers. Each has a unique `id`, `name`, `environment`, `layerId`, and `bindings` array. Multiple instances MAY bind the same layer. Each binding refers to a distinct non-root node in that layer and MAY include `resourceId`, configuration, and database `state`. Missing resource IDs are unresolved.

```json
{
  "id": "production",
  "name": "Production target",
  "environment": "production",
  "layerId": "provider",
  "bindings": [{
    "nodeId": "provider.database",
    "configuration": [{
      "name": "DATABASE_URL", "description": "Database connection", "required": true,
      "sensitive": true, "secretRef": { "nodeId": "provider.database", "key": "DATABASE_URL" }
    }]
  }]
}
```

Instance values are explicit observations or supplied descriptions, never implicit overrides of intended design values. Consumers SHOULD display them separately.

Only Store bindings may include state. State MAY contain `appliedMigration` and a `snapshot` object with required `ref` and RFC3339 `capturedAt`, and optional `sha256:...` digest. Omitted state means not supplied, not an empty database. References are opaque identifiers; consumers MUST NOT automatically fetch or restore them.

Logical entities and invariants belong in shared Data Model documents assigned to Store nodes. Technical schema, migration and seed files use source selectors or Code artifacts. Actual database records are not required. A snapshot reference does not establish that a deployment currently contains that state.

## Optional context

`system.context` MAY contain concerns, shared documents, matrix assignments, system prompts, and node-local artifacts. Omitting context does not reduce graph conformance.

### Concerns

Concerns are explicitly declared. The recommended interoperable vocabulary is:

1. `Features`
2. `General Specs`
3. `General Skills`
4. `Data Model`
5. `Interfaces`
6. `Connectivity`
7. `Security`
8. `Implementation`
9. `Deployment`

Projects MAY use a subset and MAY declare additional concerns. Names are case-sensitive.

### Documents, skills, and prompts

Shared input kinds are `Document`, `Skill`, and `Prompt`:

```json
{
  "kind": "Document",
  "hash": "sha256:...",
  "title": "Public API contract",
  "language": "en",
  "text": "...",
  "supersedes": "sha256:..."
}
```

Compute the hash from UTF-8 bytes of:

```text
kind + "\n" + title + "\n" + language + "\n" + text
```

`supersedes` is excluded. Supersession chains MUST be acyclic. Missing predecessors are allowed so a snapshot need not contain its entire history.

Matrix assignments connect a node, a declared concern, and one or more `Document` or `Skill` hashes. References MUST resolve to documents of the corresponding kind.

Prompts are not ordinary matrix references. `systemPromptRefs` belongs to context, references only `Prompt` documents, and applies to the overall system.

### Artifacts

Artifact types are `Summary`, `Docs`, and `Code`. Each belongs to one globally identified node and one declared concern.

- Summary and Docs carry UTF-8 `text` and optional language.
- Code carries `sourcePaths` that resolve to Manifest files.
- Code MUST NOT duplicate file contents already present in the embedded Bundle.

Artifact IDs are unique within the system.

## Validation order

1. Envelope, Systems version, and embedded Sources integrity.
2. Layer IDs, global node IDs, roots, containment, configuration and source selectors.
3. Layer-local edges and cycle checks.
4. Domain declarations and member references; refinement endpoints and order.
5. Instance membership, bindings, configuration, state and secret scopes.
6. Shared document hashes, concerns, matrix/artifact references, prompts and supersession chains.

Unknown node, edge, document, artifact or layer-role values are invalid. Use the `custom` role for additional refinement levels.
