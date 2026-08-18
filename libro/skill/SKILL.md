---
name: libro
description: Use when building with Libro session-bound handles, World ID 4.0 session proofs, canonical document registration, agents, and verification through LibroRegistry.
---

# Libro Protocol

Use this skill when implementing or reviewing Libro registration and verification flows.

Libro v1 permissionlessly binds one normalized handle to one World ID session commitment on a first-claim basis. Human publications and agent authorizations require `verifySession(...)` for that commitment and exact signal. The full session ID never enters Libro data.

## Workflow

1. Build the publication payload with the Libro schema and canonical JSON key ordering.
2. Use the canonical JSON string as the IDKit signal.
3. Validate the session ID, commitment, RP nonce, environment, credential, and signal hash server-side; require user presence only for flows whose policy explicitly needs it.
4. Map the first session response into `WorldIdSessionProof` without retaining the full session ID.
5. Claim-and-publish atomically on first use; otherwise call `registerHumanDocument(handleHash, signalHash, proof)`.
6. Finalize only after the exact handle-bound event is confirmed on World Chain.

## Reference

Read [references/protocol.md](references/protocol.md) when you need field mappings, ABI details, MiniKit transaction shape, privacy notes, or verification snippets.

Read [references/embed.md](references/embed.md) when publishing signed Libro text on third-party websites or implementing a browser verifier.
