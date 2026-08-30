# OpenShip Sources MCP binding

Status: Draft v1  
Protocol version: `1.0`

This optional binding lets an MCP server expose one OpenShip Sources snapshot without replacing the normative HTTP discovery, Manifest, or Bundle representations. Read [openship.md](openship.md) and [openship-sources.md](openship-sources.md) first.

## Discovery

A producer MAY advertise an absolute HTTPS Streamable HTTP endpoint as `capabilities.sources.mcp`:

```json
{
  "capabilities": {
    "sources": {
      "manifest": "https://example.com/openship/manifest.json",
      "bundle": "https://example.com/openship/bundle.json",
      "mcp": "https://mcp.example.com/mcp"
    }
  }
}
```

The MCP binding MUST expose the same current Sources snapshot as the advertised HTTP Manifest and Bundle. It MUST NOT require authentication. An MCP endpoint MAY expose unrelated authenticated tools alongside OpenShip, but authentication failures for those tools MUST NOT prevent OpenShip source reads.

## Tool

The server MUST register one tool named `openship` with this input union:

```json
{ "operation": "manifest" }
{ "operation": "read", "path": "app/page.tsx" }
```

`manifest` returns the configured OpenShip origin and its complete validated Sources Manifest. `read` accepts one exact safe Manifest path and returns the snapshot digest, file metadata, declared encoding, and content. UTF-8 content is text; binary content is canonical base64. The tool MUST NOT resolve arbitrary filesystem or URL paths.

The binding does not define a whole-Bundle tool. A client retrieves only the files it needs and verifies their metadata against the returned Manifest.

## Resources

Resource-aware servers SHOULD also expose:

- `openship://sources/manifest` with the Manifest as `application/json` text.
- `openship://sources/file{?path}` as a resource template and enumerate its concrete Manifest files from `resources/list`.

UTF-8 files use MCP text contents. Base64 files use MCP blob contents with the Manifest media type. A concrete file URI percent-encodes the complete repository path in the `path` query parameter.

## Integrity and errors

The server MUST validate the Manifest and every Bundle byte before returning source content. A changed Manifest digest requires a newly validated Bundle; an invalid or incomplete replacement MUST NOT displace the last complete cache entry or be returned as current source. Unknown and unsafe paths fail without content.

Implementations MAY impose a decoded-size limit and SHOULD report machine-readable failures for invalid paths, missing files, unavailable origins, invalid snapshots, and snapshots exceeding that limit.
