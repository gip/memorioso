# OpenShip Skills

Package release: `0.2.2` · Envelope: `openship: "1.0"`

Skills are optional Markdown instructions that help agents understand a product,
build or extend it, or reuse its capabilities (including an API or MCP tool).
A skill is a portable folder with `SKILL.md` and any supporting references,
scripts, or assets. The catalog below is a JSON transport for those files;
it does not replace Markdown as the skill format.

## Discovery

Advertise `capabilities.skills` with a non-empty `description` and an absolute
HTTPS `document` URL returning a Skills catalog. The URL MAY point to another
host, such as a shared skill repository or CDN. The host MUST support public
reads and browser CORS as described in [the overview](openship.md).

```json
{
  "skills": {
    "description": "Skills to understand, build, or reuse this product.",
    "document": "https://example.com/openship/skills.json"
  }
}
```

Skill files MAY also appear in Sources, but this is never required. Consumers MUST
load Skills from its advertised catalog independently of the Sources file set;
the Skills tab MUST show valid advertised skills even when no skill paths exist
in Sources. Skill digests describe their own files, not the project source digest.

Skills does not require Systems or Changes. Sources remains the discovery
foundation. Omit `capabilities.skills` when no catalog is provided; an empty
catalog is also valid. Present Skills immediately after System in project
navigation, with an empty state when absent.

`agent.skill` continues to identify the OpenShip protocol instructions. It is
separate from this optional product catalog. Existing Systems context documents
with `kind: "Skill"` remain valid contextual Markdown; they do not automatically
become portable catalog entries.

## Portable Markdown bundles

A catalog has `openship: "1.0"`, `capability: "skills"`, and a `skills` array.
Each entry contains:

| Field | Meaning |
| --- | --- |
| `id` | Unique lowercase letters/digits separated by hyphens, at most 64 characters. |
| `name` | Non-empty display name. |
| `description` | Non-empty explanation of when this skill helps. |
| `version` | Non-empty publisher version, preferably SemVer. |
| `purposes` | Non-empty unique subset of `understand`, `build`, `reuse`. |
| `source` | Optional HTTPS upstream URL identifying provenance. |
| `digest` | SHA-256 digest of the complete file set, defined below. |
| `files` | Map of folder-relative paths to `{ "encoding", "content" }` entries. |

`files["SKILL.md"]` MUST be non-empty UTF-8 Markdown with YAML frontmatter
containing `name` and `description`. Use the skill ID as the frontmatter name.
Other files use the Sources `utf-8` or `base64` encoding rules. Paths MUST obey
Sources safe-path rules; a file cannot also be a directory. Symlinks are not
part of this format. Include all files needed by relative links, so downloading
and republishing the folder preserves those links.

Compute each file's SHA-256 over decoded bytes. Sort paths by UTF-8 bytes and
hash the concatenation of `path + NUL + lowercaseHexHash + LF`. Prefix the result
with `sha256:`. This is the Sources digest algorithm applied to the skill's own
file set. Consumers MUST verify paths, digest, encodings, and a decoded-byte
limit before writing files. IDs MUST be unique within a catalog. A digest
verifies file integrity; it does not authenticate the publisher.

A publisher MAY obtain skill folders from npm, a repository, another catalog,
or a maintained local directory. Publish exact bytes, preserve upstream
attribution and license terms, and update the version when the skill changes.
`source` is provenance, not an instruction to recursively fetch or execute it.
Do not embed credentials. A skill describing MCP reuse should document its
endpoint, supported operations, and authentication requirements; it does not
grant access or authorize tool calls merely by being retrieved.

## Retrieval and reuse

Use `validateSkills`, `computeSkillDigest`, or `fetchSkills` from
`@openship/protocol`. `fetchOpenShip` includes an advertised catalog as `skills`.
The CLI restores a selected skill into a new folder and refuses to overwrite
an existing destination:

```sh
openship pull-skill https://example.com/openship/skills.json product-reuse ./skills/product-reuse
openship pull-skill downloaded-skills.json product-reuse ./skills/product-reuse
```

Retrieval and import do not execute scripts or automatically activate the
instructions. Consumers select relevant skills for the user's task.

For example, Memorioso can share an `understand` skill explaining its product,
a `build` skill describing its implementation, or a `reuse` skill explaining
how another product can use its public publishing capabilities through MCP.
Each is ordinary Markdown and may carry supporting references.

## MCP binding

Advertise `capabilities.skills.document` as
`{ "operation": "document", "kind": "skills" }`. Calling the public `openship`
tool with that input MUST return `{ "document": <complete Skills catalog> }`.
The existing singular `kind: "skill"` still returns protocol Markdown.
See [the MCP binding](openship-mcp.md).

## Conformance

Validate the [schema](schemas/skills.schema.json) and the file/digest invariants
above. See the [valid catalog](examples/valid/skills.json). This optional addition
ships in `@openship/protocol@0.2.2`; the envelope remains `1.0` and Systems remains
`2.0`. Older documents without Skills are unchanged.
