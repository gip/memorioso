# Libro Embed v1 Reference

## DOM declaration

Human-signed text is declared with a stable wrapper and an adjacent inert JSON data block:

```html
<div
  class="libro-human-signed"
  data-libro-claim="human-signed"
  data-libro-manifest="libro-manifest-<signal-hash>"
  data-libro-signal-hash="0x..."
>
  <p>Some text</p>
</div>
<script id="libro-manifest-<signal-hash>" type="application/libro+json">
{ "schema": "libro-embed-v1", "claim": "human-signed", "publication": {}, "registration": {} }
</script>
```

The CSS class is discoverable metadata, not proof by itself. A verifier must validate the manifest, visible text, canonical signal, approved registry, and on-chain registration before displaying a verified state. Escape `<` as `\u003c` when serializing the JSON data block.

## Plain-text declaration

Platforms that preserve text but strip HTML can carry the same claim with a delimited block:

```text
=== Libro · Signed by a human · @ada · 2026-07-21T12:00Z · 0x<full-signal-hash> · https://memorioso.xyz/api/publications/42/libro-manifest ===
Some text
=== End Libro ===
```

The timestamp is the publication time normalized to UTC minute precision. The signal hash must be the complete 32-byte hash. The HTTPS URL returns the public `libro-embed-v1` manifest; it is a location, not a trust input. A verifier must retrieve the manifest, require the URL to match `source.manifest_url`, compare the tagged handle, timestamp, and readable body with the signed publication, and then perform all normal manifest and on-chain checks. Legacy labels containing only a shortened hash may be detected, but cannot be verified without a matching inline manifest.

## Manifest

`publication` is the complete canonical direct-human `libro-publication-v1` or agent `libro-agent-publication-v1` object. `registration` contains:

- `chain_id`: `480`
- `registry_address`: the approved Libro v1 registry
- `signal_hash`: the World ID signal field hash
- `handle_hash`: `keccak256` of the normalized author handle
- `authorship_class`: `human` or `agent`, matching the payload and claim
- `transaction_hash`: the successful registration transaction

An optional `source` object may link to the publication and proof pages, but verifiers must not use those URLs as trust inputs.

## Readable-text binding

Libro embed v1 proves readable text rather than exact markup. Parse both the signed `publication_content.html` and the wrapper HTML, ignore executable and non-text elements, insert boundaries around block elements and `<br>`, decode entities, normalize to Unicode NFC, collapse Unicode whitespace, and compare the resulting strings exactly. Styling, links, images, CSS-generated content, and legal identity are outside this claim.

## Verification

1. Require exactly one referenced `application/libro+json` data block.
2. Validate `libro-embed-v1` and the matching pair: `human-signed` / `libro-publication-v1`, or `human-authorized-agent` / `libro-agent-publication-v1`.
3. Compare normalized embedded and signed readable text.
4. Canonicalize the publication, recompute its signal hash and normalized handle hash.
5. Require World Chain `480` and an approved registry address.
6. Call `LibroRegistry.verifyHumanDocument(signalHash, handleHash)` for humans or `verifyAgentDocument(signalHash, handleHash)` for agents.
7. Require the declared receipt to contain the matching `HumanDocumentRegistered` or `AgentDocumentRegistered` event, including the exact signal and handle, from that registry.

For a plain-text declaration, resolve its manifest first and additionally require the boundary's full signal hash, author handle, UTC minute timestamp, and normalized body text to match it.

Network failures are unknown results, not proof failures. Human-authorized agent publications use the same registry but a distinct claim label and must never be presented as direct human authorship.
