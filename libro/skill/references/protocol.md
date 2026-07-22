# Libro v1 Protocol Reference

## Canonical Signal

The signed signal is the canonical JSON string of the publication payload. Keys are sorted recursively before `JSON.stringify`, and undefined fields are omitted. New Libro publications use `publication_schema: "libro-publication-v1"` while preserving legacy fields such as `author_id_libro`, `author_name_libro`, `publication_title`, `publication_content`, and `publication_date`.

The signal hash is the World ID `hashSignal(signalText)` field-element hash. This value must match every `responses[].signal_hash` in the IDKit result and is passed to the registry as `uint256 signalHash`.

`publication_title` and `publication_subtitle` are always present strings but may be empty. Producers normalize absent or whitespace-only values to `""`; they do not omit these fields or encode them as `null`. `publication_content.html` must produce non-empty readable text after HTML parsing, entity decoding, Unicode NFC normalization, and whitespace collapsing. Scripts, styles, templates, images, and other non-text media do not count as body text.

## World ID 4.0 Mapping

For a v4 uniqueness proof, map the first accepted credential response:

- `proof.nullifier` = `BigInt(response.nullifier)`
- `proof.nonce` = `BigInt(idkitResult.nonce)`
- `proof.expiresAtMin` = `response.expires_at_min`
- `proof.issuerSchemaId` = `response.issuer_schema_id`
- `proof.credentialGenesisIssuedAtMin` = `response.credential_genesis_issued_at_min ?? 0`
- `proof.zeroKnowledgeProof` = `response.proof` as exactly five `uint256` values

The registry constructor fixes:

- World ID v4 verifier address
- numeric `rpId` (`uint64`), derived from `WORLD_ID_RP_ID` by interpreting the 16 hex characters after `rp_`

Each publication uses a one-time World ID action shaped as `written-by-a-human-v4-<challengeId>`. The app hashes that full action string and passes the resulting field element to the registry with the proof.

## Contract ABI

```solidity
function register(uint256 signalHash, uint256 actionHash, WorldIdV4Proof calldata proof) external;
function verify(uint256 signalHash) external view returns (bool);
event SignalRegistered(uint256 indexed signalHash, uint256 indexed actionHash);
```

`LibroProofRegistry` is permissionless. Any account, relayer, backend, or MiniKit wallet can call `register` as long as the calldata contains a valid World ID proof for the signal. The caller is not part of the proof.

The registry stores only `mapping(uint256 => bool)` for signal existence. It does not store wallet addresses or nullifiers. Reusing the same nullifier for multiple distinct signals is allowed so one human can publish multiple documents.

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
  abi: libroProofRegistryAbi,
  functionName: 'verify',
  args: [BigInt(signalHash)],
});
```

The result is true only if the signal was previously registered through a successful World ID verifier call.

For website embeds, also recompute readable text from both the embedded DOM and `publication_content.html`, validate the approved chain and registry, and confirm the declared registration receipt emitted `SignalRegistered` with the expected signal and action hashes. See [embed.md](embed.md).

## Privacy Note

Libro v1 uses per-challenge actions such as `written-by-a-human-v4-<challengeId>`. World ID v4 nullifiers are stable for a human/RP/action, so changing the action per publication avoids reusing the same nullifier across direct human publications.
