---
name: libro
description: Use when building with the Libro protocol for human-signed document registration: canonical publication signals, World ID 4.0 proof mapping, MiniKit registration transactions, and on-chain verification through LibroProofRegistry.
---

# Libro Protocol

Use this skill when implementing or reviewing Libro registration and verification flows.

Libro v1 proves that a World ID 4.0 Proof of Human was used to sign a specific canonical document signal. The proof must be registered on-chain through `LibroProofRegistry.register(...)` while the World ID proof is fresh; after registration, anyone can call `verify(signalHash)` to check persistence. The registry is permissionless: anyone can call `register` with valid calldata. MiniKit is only Memorioso's sponsored-gas submission path.

## Workflow

1. Build the publication payload with the Libro schema and canonical JSON key ordering.
2. Use the canonical JSON string as the IDKit signal.
3. Validate the IDKit result server-side against the challenge context before preparing calldata.
4. Map the first World ID v4 credential response into `WorldIdV4Proof`.
5. Submit `LibroProofRegistry.register(signalHash, actionHash, proof)` with any EVM transaction sender; use MiniKit `sendTransaction` when the app wants World App gas sponsorship.
6. Finalize publication only after `LibroProofRegistry.verify(signalHash)` returns true.

## Reference

Read [references/protocol.md](references/protocol.md) when you need field mappings, ABI details, MiniKit transaction shape, privacy notes, or verification snippets.

Read [references/embed.md](references/embed.md) when publishing signed Libro text on third-party websites or implementing a browser verifier.
