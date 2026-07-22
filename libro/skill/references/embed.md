# Libro Embed v1 Reference

## DOM declaration

Directly human-authored text is declared with a stable wrapper and an adjacent inert JSON data block:

```html
<div
  class="libro-human-authored"
  data-libro-claim="human-authored"
  data-libro-manifest="libro-manifest-<signal-hash>"
  data-libro-signal-hash="0x..."
>
  <p>Some text</p>
</div>
<script id="libro-manifest-<signal-hash>" type="application/libro+json">
{ "schema": "libro-embed-v1", "claim": "human-authored", "publication": {}, "registration": {} }
</script>
```

The CSS class is discoverable metadata, not proof by itself. A verifier must validate the manifest, visible text, canonical signal, approved registry, and on-chain registration before displaying a verified state. Escape `<` as `\u003c` when serializing the JSON data block.

## Plain-text declaration

Platforms that preserve text but strip HTML can carry the same claim with a delimited block:

```text
=== Libro · Signed by a human · @ada · 2026-07-21 · 0x<full-signal-hash> · https://memorioso.xyz/api/publications/42/libro-manifest ===
Some text
=== End Libro ===
```

The signal hash must be the complete 32-byte hash. The HTTPS URL returns the public `libro-embed-v1` manifest; it is a location, not a trust input. A verifier must retrieve the manifest, require the URL to match `source.manifest_url`, compare the tagged handle, date, and readable body with the signed publication, and then perform all normal manifest and on-chain checks. Legacy labels containing only a shortened hash may be detected, but cannot be verified without a matching inline manifest.

## Manifest

`publication` is the complete canonical `libro-publication-v1` object. `registration` contains:

- `chain_id`: `480`
- `registry_address`: the approved Libro v1 registry
- `signal_hash`: the World ID signal field hash
- `action_hash`: the World ID action field hash used by `register`
- `transaction_hash`: the successful registration transaction

An optional `source` object may link to the publication and proof pages, but verifiers must not use those URLs as trust inputs.

## Readable-text binding

Libro embed v1 proves readable text rather than exact markup. Parse both the signed `publication_content.html` and the wrapper HTML, ignore executable and non-text elements, insert boundaries around block elements and `<br>`, decode entities, normalize to Unicode NFC, collapse Unicode whitespace, and compare the resulting strings exactly. Styling, links, images, CSS-generated content, and legal identity are outside this claim.

## Verification

1. Require exactly one referenced `application/libro+json` data block.
2. Validate `libro-embed-v1`, `human-authored`, and the direct `libro-publication-v1` payload.
3. Compare normalized embedded and signed readable text.
4. Canonicalize the publication, recompute its signal hash, and recompute the action hash.
5. Require World Chain `480` and an approved registry address.
6. Call `LibroProofRegistry.verify(signalHash)`.
7. Require the declared successful transaction receipt to contain the matching `SignalRegistered(signalHash, actionHash)` event from that registry.

For a plain-text declaration, resolve its manifest first and additionally require the boundary's full signal hash, author handle, publication date, and normalized body text to match it.

Network failures are unknown results, not proof failures. Human-authorized agent publications use a separate registry and claim label and must never be presented as direct human authorship.
