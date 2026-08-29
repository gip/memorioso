# Libro v1 Protocol Reference

Libro's registry and proof protocol remains `libro-v1`. New direct-human publications use
`publication_schema: "libro-publication-v2"`, and new agent publications use
`publication_schema: "libro-agent-publication-v2"`. Verifiers must continue accepting both v1
publication schemas because their registered signal hashes are permanent.

## Canonical Signal

The signed signal is the canonical JSON string of the publication payload. Keys are sorted recursively before `JSON.stringify`, and undefined fields are omitted. Direct-human v1 and v2 signals replace `publication_content` with its canonical `content_hash`; agent publication signals retain the complete payload.

Publication schema v1 requires the legacy, publisher-local `author_id_libro` string. Publication
schema v2 removes that field and allows this scoped metadata instead:

```json
{
  "author_reference": {
    "namespace": "https://memorioso.xyz",
    "id": "8d22d0e5-2a31-42ca-9356-6e2b3c16a4aa"
  }
}
```

`author_reference` is optional and is never authorship evidence. Its `namespace` is a canonical
HTTPS origin with no credentials, path, query, fragment, or trailing slash; HTTP is permitted only
for localhost development. Its opaque `id` is trimmed, non-empty, and at most 256 characters. The
object has exactly those two properties. Libro does not require the id to be a UUID. The normalized
handle hash bound to the World ID session remains the protocol author identity.

The signal hash is the World ID `hashSignal(signalText)` field-element hash. This value must match every `responses[].signal_hash` in the IDKit result and is passed to the registry as `uint256 signalHash`.

Direct Libro publications require `world_id_credential_policy: "orb"` and reject broader or document-based policies.

`publication_title` and `publication_subtitle` are always present strings but may be empty. Producers normalize absent or whitespace-only values to `""`; they do not omit these fields or encode them as `null`. A publication must have either a non-empty normalized title or readable text in `publication_content.html`. Body text is evaluated after HTML parsing, entity decoding, Unicode NFC normalization, and whitespace collapsing; scripts, styles, templates, images, and other non-text media do not count.

## World ID 4.0 Mapping

For a v4 session proof, map the first accepted credential response:

- `proof.sessionCommitment` = the first 32 bytes of the verified `session_id`
- `proof.nonce` = `BigInt(idkitResult.nonce)`
- `proof.expiresAtMin` = `response.expires_at_min`
- `proof.issuerSchemaId` = `response.issuer_schema_id`
- `proof.credentialGenesisIssuedAtMin` = `response.credential_genesis_issued_at_min ?? 0`
- `proof.sessionNullifier` = `response.session_nullifier` as exactly two `uint256` values
- `proof.zeroKnowledgeProof` = `response.proof` as exactly five `uint256` values

The registry constructor fixes:

- World ID v4 verifier address
- numeric `rpId` (`uint64`), derived from `WORLD_ID_RP_ID` by interpreting the 16 hex characters after `rp_`

Session requests have no action and use the canonical publication JSON as the credential signal. Direct publication does not force an additional user-presence check; agent authorization does. Publication schema v2 does not change this proof mapping or the registry ABI.

## Contract ABI

```solidity
function claimHandleAndRegisterHumanDocument(string calldata handle, uint256 signalHash, WorldIdSessionProof calldata proof) external;
function registerHumanDocument(bytes32 handleHash, uint256 signalHash, WorldIdSessionProof calldata proof) external;
function verifyHumanDocument(uint256 signalHash, bytes32 handleHash) external view returns (bool);
event HumanDocumentRegistered(uint256 indexed signalHash, bytes32 indexed handleHash, uint256 indexed sessionNullifier);
```

Handle claims and submission are permissionless. An unclaimed normalized handle is permanently assigned to the first valid World ID session proof, and later proofs must resolve to that registered session commitment.

The registry stores bidirectional handle/session mappings, consumes session nullifiers, and stores the handle for every document. Claims cannot be transferred or overwritten.

## Transaction Submission

MiniKit v2 inside World App is the preferred Memorioso UX because it can sponsor gas, but it is not required by the Libro protocol. The same `registerCalldata` can be sent by any EVM transaction sender.

```ts
await MiniKit.sendTransaction({
  chainId: 480,
  transactions: [{
    to: registryAddress,
    data: registerCalldata,
    value: '0x0',
  }],
});
```

After MiniKit submission, poll the user operation receipt and send only `userOpHash` and final `transactionHash` to the backend. Do not persist MiniKit `from` or any wallet metadata.

## Verification

Independent verification recomputes the canonical signal hash and calls:

```ts
const registered = await publicClient.readContract({
  address: registryAddress,
  abi: libroRegistryAbi,
  functionName: 'verifyHumanDocument',
  args: [BigInt(signalHash), handleHash],
});
```

The result is true only if the signal was previously registered through a successful World ID verifier call.

For website embeds, also compare the payload handle hash with `HumanDocumentRegistered`. See [embed.md](embed.md).

## Privacy Note

Only the public 32-byte session commitment is used on-chain. The 32-byte proving seed and full 64-byte session identifier must stay server-side.
