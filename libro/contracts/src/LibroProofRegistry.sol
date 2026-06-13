// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IWorldIDVerifier {
    function verify(
        uint256 nullifier,
        uint256 action,
        uint64 rpId,
        uint256 nonce,
        uint256 signalHash,
        uint64 expiresAtMin,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        uint256[5] calldata zeroKnowledgeProof
    ) external view;
}

contract LibroProofRegistry {
    struct WorldIdV4Proof {
        uint256 nullifier;
        uint256 nonce;
        uint64 expiresAtMin;
        uint64 issuerSchemaId;
        uint256 credentialGenesisIssuedAtMin;
        uint256[5] zeroKnowledgeProof;
    }

    IWorldIDVerifier public immutable worldIdVerifier;
    uint64 public immutable rpId;

    mapping(uint256 => bool) private registeredSignals;

    event SignalRegistered(uint256 indexed signalHash, uint256 indexed actionHash);

    error InvalidVerifier();
    error InvalidRpId();
    error InvalidActionHash();
    error InvalidSignalHash();
    error SignalAlreadyRegistered(uint256 signalHash);

    constructor(address _worldIdVerifier, uint64 _rpId) {
        if (_worldIdVerifier == address(0)) revert InvalidVerifier();
        if (_rpId == 0) revert InvalidRpId();

        worldIdVerifier = IWorldIDVerifier(_worldIdVerifier);
        rpId = _rpId;
    }

    // Permissionless: any caller can submit a valid proof for a signal.
    function register(uint256 signalHash, uint256 actionHash, WorldIdV4Proof calldata proof) external {
        if (signalHash == 0) revert InvalidSignalHash();
        if (actionHash == 0) revert InvalidActionHash();
        if (registeredSignals[signalHash]) revert SignalAlreadyRegistered(signalHash);

        worldIdVerifier.verify(
            proof.nullifier,
            actionHash,
            rpId,
            proof.nonce,
            signalHash,
            proof.expiresAtMin,
            proof.issuerSchemaId,
            proof.credentialGenesisIssuedAtMin,
            proof.zeroKnowledgeProof
        );

        registeredSignals[signalHash] = true;

        emit SignalRegistered(signalHash, actionHash);
    }

    function verify(uint256 signalHash) external view returns (bool) {
        return registeredSignals[signalHash];
    }
}
