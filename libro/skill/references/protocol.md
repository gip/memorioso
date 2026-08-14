# Libro v1 Protocol Reference

## Canonical Signal

The signed signal is the canonical JSON string of the publication payload. Keys are sorted recursively before `JSON.stringify`, and undefined fields are omitted. New Libro publications use `publication_schema: "libro-publication-v1"` while preserving legacy fields such as `author_id_libro`, `author_name_libro`, `publication_title`, `publication_content`, and `publication_date`.

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

Session requests have no action. They require user presence and use the canonical publication JSON as the credential signal.

## Contract ABI

```solidity
function claimHandleAndRegisterHumanDocument(string calldata handle, uint256 signalHash, WorldIdSessionProof calldata proof, HandleClaimPermit calldata permit) external;
function registerHumanDocument(bytes32 handleHash, uint256 signalHash, WorldIdSessionProof calldata proof) external;
function verifyHumanDocument(uint256 signalHash, bytes32 handleHash) external view returns (bool);
event HumanDocumentRegistered(uint256 indexed signalHash, bytes32 indexed handleHash, uint256 indexed sessionNullifier);
```

Submission remains permissionless, but the proof must resolve to the permanent session commitment registered for the declared handle.

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
