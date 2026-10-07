// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LibroRegistry, IWorldIDVerifier} from "./LibroRegistry.sol";

contract LibroRegistryV2 {
    struct WorldIdSessionProof {
        uint256 sessionCommitment;
        uint256 nonce;
        uint64 expiresAtMin;
        uint64 issuerSchemaId;
        uint256 credentialGenesisIssuedAtMin;
        uint256[2] sessionNullifier;
        uint256[5] zeroKnowledgeProof;
    }

    struct AgentRegistration {
        bytes32 handleHash;
        address controllerAddress;
        address agentAddress;
        uint256 scope;
        uint64 validFrom;
        uint64 expiresAt;
        bytes32 salt;
    }

    struct StoredAgentRegistration {
        bytes32 handleHash;
        address controllerAddress;
        address agentAddress;
        uint256 scope;
        uint64 validFrom;
        uint64 expiresAt;
        bool revoked;
    }

    uint256 public constant SCOPE_PUBLISH_DOCUMENT = 1;

    bytes32 public constant AGENT_REGISTRATION_TYPEHASH = keccak256(
        "LibroAgentRegistration(bytes32 handleHash,address controllerAddress,address agentAddress,uint256 scope,uint64 validFrom,uint64 expiresAt,bytes32 salt,uint256 chainId,address registryAddress)"
    );
    bytes32 public constant AGENT_DOCUMENT_TYPEHASH = keccak256(
        "AgentDocument(bytes32 registrationHash,uint256 documentSignalHash,bytes32 documentNonce,uint64 signedAt)"
    );
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant NAME_HASH = keccak256("LibroRegistry");
    bytes32 public constant VERSION_HASH = keccak256("2");

    struct PublicationCommitment {
        bytes32 payloadHash;
        address previousRegistry;
        uint256 previousSignalHash;
    }
    struct PublicationReference { address registry; uint256 signalHash; }
    struct PublicationRecord {
        bytes32 handleHash;
        uint8 authorshipClass;
        PublicationReference root;
        PublicationReference previous;
        uint256 revisionNumber;
    }
    struct PublicationStatus {
        bool exists;
        address originalRegistry;
        bytes32 handleHash;
        uint8 authorshipClass;
        PublicationReference previous;
        PublicationReference next;
        PublicationReference root;
        PublicationReference latest;
        uint256 revisionNumber;
        bool isLatest;
    }
    bytes32 public constant PUBLICATION_COMMITMENT_TYPEHASH = keccak256(
        "PublicationCommitmentV2(bytes32 payloadHash,bytes32 handleHash,address previousRegistry,uint256 previousSignalHash,uint8 authorshipClass,uint256 chainId,address registryAddress)"
    );
    LibroRegistry public immutable v1Registry;
    mapping(bytes32 => PublicationRecord) private publications;
    mapping(bytes32 => PublicationReference) private successors;
    mapping(bytes32 => PublicationReference) private heads;
    event V1PublicationReferenced(uint256 indexed signalHash, bytes32 indexed handleHash, address indexed sourceRegistry, uint8 authorshipClass);
    event PublicationUpdated(uint256 indexed previousSignalHash, uint256 indexed newSignalHash, bytes32 indexed handleHash, address previousRegistry, address rootRegistry, uint256 rootSignalHash, uint256 revisionNumber);
    error InvalidPredecessor();
    error RevisionConflict();
    error AgentCannotReviseHuman();

    IWorldIDVerifier public immutable worldIdVerifier;
    uint64 public immutable rpId;

    mapping(bytes32 => uint256) public handleSessionCommitments;
    mapping(uint256 => bytes32) public sessionCommitmentHandles;
    mapping(uint256 => bool) public usedSessionNullifiers;
    mapping(uint256 => bytes32) public humanDocumentHandles;
    mapping(bytes32 => StoredAgentRegistration) public agentRegistrations;
    mapping(uint256 => bytes32) public agentDocumentRegistrations;

    event HandleClaimed(bytes32 indexed handleHash, uint256 indexed sessionCommitment);
    event HumanDocumentRegistered(
        uint256 indexed documentSignalHash, bytes32 indexed handleHash, uint256 indexed sessionNullifier
    );
    event AgentRegistered(
        bytes32 indexed registrationHash,
        bytes32 indexed handleHash,
        address indexed agentAddress,
        address controllerAddress,
        uint256 scope,
        uint64 expiresAt,
        uint256 sessionNullifier
    );
    event AgentRevoked(bytes32 indexed registrationHash, bytes32 indexed handleHash);
    event AgentDocumentRegistered(
        uint256 indexed documentSignalHash,
        bytes32 indexed registrationHash,
        bytes32 indexed handleHash,
        address agentAddress,
        bytes32 documentNonce,
        uint64 signedAt
    );
    error InvalidVerifier();
    error InvalidRpId();
    error InvalidHandle();
    error InvalidSessionCommitment();
    error HandleAlreadyClaimed(bytes32 handleHash);
    error SessionAlreadyClaimed(uint256 sessionCommitment);
    error HandleNotClaimed(bytes32 handleHash);
    error SessionDoesNotOwnHandle(bytes32 handleHash);
    error SessionNullifierAlreadyUsed(uint256 nullifier);
    error InvalidDocumentSignalHash();
    error DocumentAlreadyRegistered(uint256 documentSignalHash);
    error InvalidRegistration();
    error AgentAlreadyRegistered(bytes32 registrationHash);
    error AgentNotRegistered(bytes32 registrationHash);
    error AgentRegistrationExpired(bytes32 registrationHash);
    error AgentRegistrationNotYetValid(bytes32 registrationHash);
    error AgentRevokedError(bytes32 registrationHash);
    error UnauthorizedController();
    error InvalidAgentSignature();
    error InvalidSignatureLength();

    constructor(address predecessor, address verifier, uint64 relyingPartyId) {
        if (verifier == address(0)) revert InvalidVerifier();
        if (relyingPartyId == 0) revert InvalidRpId();
        if (predecessor == address(0) || predecessor.code.length == 0) revert InvalidPredecessor();
        v1Registry = LibroRegistry(predecessor);
        if (address(v1Registry.worldIdVerifier()) != verifier || v1Registry.rpId() != relyingPartyId) revert InvalidPredecessor();
        worldIdVerifier = IWorldIDVerifier(verifier);
        rpId = relyingPartyId;
    }

    function importHandle(bytes32 handleHash) public {
        uint256 commitment = v1Registry.handleSessionCommitments(handleHash);
        if (commitment == 0 || v1Registry.sessionCommitmentHandles(commitment) != handleHash) revert HandleNotClaimed(handleHash);
        if (handleSessionCommitments[handleHash] == commitment) return;
        _claimHandle(handleHash, commitment);
    }

    function claimHandle(string calldata handle, WorldIdSessionProof calldata proof) external {
        bytes32 handleHash = hashHandle(handle);
        if (v1Registry.handleSessionCommitments(handleHash) == 0) {
            // V1 verifies and consumes the claim proof; a failure rolls back both reservations.
            v1Registry.claimHandle(handle, LibroRegistry.WorldIdSessionProof({
                sessionCommitment: proof.sessionCommitment, nonce: proof.nonce,
                expiresAtMin: proof.expiresAtMin, issuerSchemaId: proof.issuerSchemaId,
                credentialGenesisIssuedAtMin: proof.credentialGenesisIssuedAtMin,
                sessionNullifier: proof.sessionNullifier, zeroKnowledgeProof: proof.zeroKnowledgeProof
            }));
        }
        if (v1Registry.handleSessionCommitments(handleHash) != proof.sessionCommitment) revert SessionDoesNotOwnHandle(handleHash);
        importHandle(handleHash);
    }

    function registerAgent(AgentRegistration calldata registration, WorldIdSessionProof calldata proof) external {
        if (handleSessionCommitments[registration.handleHash] == 0) importHandle(registration.handleHash);
        _registerAgent(registration, proof);
    }

    function getPublicationSignalHash(bytes32 handleHash, PublicationCommitment calldata commitment, uint8 authorshipClass) public view returns (uint256) {
        bytes32 digest = keccak256(abi.encode(PUBLICATION_COMMITMENT_TYPEHASH, commitment.payloadHash,
            handleHash, commitment.previousRegistry, commitment.previousSignalHash, authorshipClass, block.chainid, address(this)));
        return uint256(keccak256(bytes(string.concat("libro-publication-v2:", _toHexString(digest))))) >> 8;
    }

    function registerHumanPublication(bytes32 handleHash, PublicationCommitment calldata commitment, WorldIdSessionProof calldata proof) external {
        if (handleSessionCommitments[handleHash] == 0) importHandle(handleHash);
        _requireSessionOwnsHandle(handleHash, proof.sessionCommitment);
        uint256 signalHash = getPublicationSignalHash(handleHash, commitment, 1);
        _registerPublication(handleHash, signalHash, commitment, 1);
        uint256 nullifier = _verifyAndConsumeSession(proof, signalHash);
        humanDocumentHandles[signalHash] = handleHash;
        emit HumanDocumentRegistered(signalHash, handleHash, nullifier);
    }

    function revokeAgent(bytes32 registrationHash) external {
        StoredAgentRegistration storage registration = agentRegistrations[registrationHash];
        if (registration.agentAddress == address(0)) revert AgentNotRegistered(registrationHash);
        if (msg.sender != registration.controllerAddress) revert UnauthorizedController();
        if (registration.revoked) revert AgentRevokedError(registrationHash);

        registration.revoked = true;
        emit AgentRevoked(registrationHash, registration.handleHash);
    }

    function registerAgentPublication(bytes32 registrationHash, PublicationCommitment calldata commitment, bytes32 documentNonce, uint64 signedAt, bytes calldata signature) external {
        StoredAgentRegistration memory registration = _requireActiveRegistration(registrationHash, signedAt);
        uint256 signalHash = getPublicationSignalHash(registration.handleHash, commitment, 2);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(AGENT_DOCUMENT_TYPEHASH, registrationHash, signalHash, documentNonce, signedAt)));
        if (_recover(digest, signature) != registration.agentAddress) revert InvalidAgentSignature();
        _registerPublication(registration.handleHash, signalHash, commitment, 2);
        agentDocumentRegistrations[signalHash] = registrationHash;
        emit AgentDocumentRegistered(signalHash, registrationHash, registration.handleHash, registration.agentAddress, documentNonce, signedAt);
    }

    function publicationKey(address registry, uint256 signalHash) public pure returns (bytes32) {
        return keccak256(abi.encode(registry, signalHash));
    }

    function _v1Record(uint256 signalHash) internal view returns (PublicationRecord memory record) {
        record.handleHash = v1Registry.humanDocumentHandles(signalHash);
        if (record.handleHash != bytes32(0)) record.authorshipClass = 1;
        else {
            bytes32 registrationHash = v1Registry.agentDocumentRegistrations(signalHash);
            if (registrationHash == bytes32(0)) return record;
            (bytes32 handleHash,,,,,,) = v1Registry.agentRegistrations(registrationHash);
            if (!v1Registry.verifyAgentDocument(signalHash, handleHash)) return record;
            record.handleHash = handleHash;
            record.authorshipClass = 2;
        }
        record.root = PublicationReference(address(v1Registry), signalHash);
        record.revisionNumber = 1;
    }

    function referenceV1Publication(uint256 signalHash) public {
        bytes32 key = publicationKey(address(v1Registry), signalHash);
        if (publications[key].handleHash != bytes32(0)) return;
        PublicationRecord memory record = _v1Record(signalHash);
        if (record.handleHash == bytes32(0)) revert InvalidPredecessor();
        publications[key] = record;
        heads[key] = record.root;
        emit V1PublicationReferenced(signalHash, record.handleHash, address(v1Registry), record.authorshipClass);
    }

    function getPublicationStatus(address registry, uint256 signalHash) external view returns (PublicationStatus memory status) {
        bytes32 key = publicationKey(registry, signalHash);
        PublicationRecord memory record = publications[key];
        if (record.handleHash == bytes32(0) && registry == address(v1Registry)) record = _v1Record(signalHash);
        if (record.handleHash == bytes32(0)) return status;
        status.exists = true;
        status.originalRegistry = registry;
        status.handleHash = record.handleHash;
        status.authorshipClass = record.authorshipClass;
        status.previous = record.previous;
        status.next = successors[key];
        status.root = record.root;
        status.latest = heads[publicationKey(record.root.registry, record.root.signalHash)];
        if (status.latest.registry == address(0)) status.latest = record.root;
        status.revisionNumber = record.revisionNumber;
        status.isLatest = publicationKey(status.latest.registry, status.latest.signalHash) == key;
    }

    function _registerPublication(bytes32 handleHash, uint256 signalHash, PublicationCommitment calldata commitment, uint8 authorshipClass) internal {
        bytes32 key = publicationKey(address(this), signalHash);
        if (signalHash == 0 || commitment.payloadHash == bytes32(0)) revert InvalidDocumentSignalHash();
        if (publications[key].handleHash != bytes32(0)) revert DocumentAlreadyRegistered(signalHash);
        PublicationReference memory current = PublicationReference(address(this), signalHash);
        PublicationRecord memory record;
        record.handleHash = handleHash;
        record.authorshipClass = authorshipClass;
        record.root = current;
        record.revisionNumber = 1;
        if (commitment.previousRegistry == address(0)) {
            if (commitment.previousSignalHash != 0) revert InvalidPredecessor();
        } else {
            if (commitment.previousSignalHash == 0) revert InvalidPredecessor();
            if (commitment.previousRegistry == address(v1Registry)) referenceV1Publication(commitment.previousSignalHash);
            else if (commitment.previousRegistry != address(this)) revert InvalidPredecessor();
            bytes32 previousKey = publicationKey(commitment.previousRegistry, commitment.previousSignalHash);
            PublicationRecord memory previous = publications[previousKey];
            if (previous.handleHash == bytes32(0)) revert InvalidPredecessor();
            if (previous.handleHash != handleHash) revert SessionDoesNotOwnHandle(previous.handleHash);
            if (authorshipClass == 2 && previous.authorshipClass != 2) revert AgentCannotReviseHuman();
            bytes32 rootKey = publicationKey(previous.root.registry, previous.root.signalHash);
            PublicationReference memory head = heads[rootKey];
            if (publicationKey(head.registry, head.signalHash) != previousKey) revert RevisionConflict();
            record.root = previous.root;
            record.previous = PublicationReference(commitment.previousRegistry, commitment.previousSignalHash);
            record.revisionNumber = previous.revisionNumber + 1;
            successors[previousKey] = current;
            emit PublicationUpdated(commitment.previousSignalHash, signalHash, handleHash, commitment.previousRegistry,
                record.root.registry, record.root.signalHash, record.revisionNumber);
        }
        publications[key] = record;
        heads[publicationKey(record.root.registry, record.root.signalHash)] = current;
    }

    function verifyHumanDocument(uint256 documentSignalHash, bytes32 handleHash) external view returns (bool) {
        return handleHash != bytes32(0) && humanDocumentHandles[documentSignalHash] == handleHash;
    }

    function verifyAgent(bytes32 registrationHash, bytes32 handleHash) external view returns (bool) {
        StoredAgentRegistration memory registration = agentRegistrations[registrationHash];
        return registration.handleHash == handleHash && registration.agentAddress != address(0) && !registration.revoked
            && registration.validFrom <= block.timestamp && block.timestamp <= registration.expiresAt;
    }

    function verifyAgentDocument(uint256 documentSignalHash, bytes32 handleHash) external view returns (bool) {
        bytes32 registrationHash = agentDocumentRegistrations[documentSignalHash];
        if (registrationHash == bytes32(0)) return false;
        StoredAgentRegistration memory registration = agentRegistrations[registrationHash];
        return registration.handleHash == handleHash && registration.agentAddress != address(0) && !registration.revoked;
    }

    function getAgentRegistrationHash(AgentRegistration calldata registration) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                AGENT_REGISTRATION_TYPEHASH,
                registration.handleHash,
                registration.controllerAddress,
                registration.agentAddress,
                registration.scope,
                registration.validFrom,
                registration.expiresAt,
                registration.salt,
                block.chainid,
                address(this)
            )
        );
    }

    function getAgentRegistrationSignalHash(AgentRegistration calldata registration) public view returns (uint256) {
        return uint256(keccak256(bytes(_toHexString(getAgentRegistrationHash(registration))))) >> 8;
    }

    function getHandleClaimSignalHash(string calldata handle) public pure returns (uint256) {
        hashHandle(handle);
        return uint256(keccak256(bytes(string.concat("libro-handle-claim-v1:", handle)))) >> 8;
    }

    function hashHandle(string calldata handle) public pure returns (bytes32) {
        bytes calldata value = bytes(handle);
        if (value.length < 3 || value.length > 32) revert InvalidHandle();
        for (uint256 i = 0; i < value.length; i++) {
            bytes1 char = value[i];
            if (!((char >= 0x61 && char <= 0x7a) || (char >= 0x30 && char <= 0x39) || char == 0x5f || char == 0x2d)) {
                revert InvalidHandle();
            }
        }
        return keccak256(value);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _claimHandle(bytes32 handleHash, uint256 sessionCommitment) internal {
        if (sessionCommitment == 0) revert InvalidSessionCommitment();
        if (handleSessionCommitments[handleHash] != 0) revert HandleAlreadyClaimed(handleHash);
        if (sessionCommitmentHandles[sessionCommitment] != bytes32(0)) {
            revert SessionAlreadyClaimed(sessionCommitment);
        }
        handleSessionCommitments[handleHash] = sessionCommitment;
        sessionCommitmentHandles[sessionCommitment] = handleHash;
        emit HandleClaimed(handleHash, sessionCommitment);
    }

    function _registerAgent(AgentRegistration calldata registration, WorldIdSessionProof calldata proof) internal {
        _validateRegistration(registration);
        _requireSessionOwnsHandle(registration.handleHash, proof.sessionCommitment);

        bytes32 registrationHash = getAgentRegistrationHash(registration);
        if (agentRegistrations[registrationHash].agentAddress != address(0)) {
            revert AgentAlreadyRegistered(registrationHash);
        }
        uint256 nullifier = _verifyAndConsumeSession(proof, getAgentRegistrationSignalHash(registration));

        agentRegistrations[registrationHash] = StoredAgentRegistration({
            handleHash: registration.handleHash,
            controllerAddress: registration.controllerAddress,
            agentAddress: registration.agentAddress,
            scope: registration.scope,
            validFrom: registration.validFrom,
            expiresAt: registration.expiresAt,
            revoked: false
        });
        emit AgentRegistered(
            registrationHash,
            registration.handleHash,
            registration.agentAddress,
            registration.controllerAddress,
            registration.scope,
            registration.expiresAt,
            nullifier
        );
    }

    function _verifyAndConsumeSession(WorldIdSessionProof calldata proof, uint256 signalHash)
        internal
        returns (uint256 nullifier)
    {
        if (proof.sessionCommitment == 0) revert InvalidSessionCommitment();
        nullifier = proof.sessionNullifier[0];
        if (nullifier == 0 || usedSessionNullifiers[nullifier]) revert SessionNullifierAlreadyUsed(nullifier);

        worldIdVerifier.verifySession(
            rpId,
            proof.nonce,
            signalHash,
            proof.expiresAtMin,
            proof.issuerSchemaId,
            proof.credentialGenesisIssuedAtMin,
            proof.sessionCommitment,
            proof.sessionNullifier,
            proof.zeroKnowledgeProof
        );
        usedSessionNullifiers[nullifier] = true;
    }

    function _requireSessionOwnsHandle(bytes32 handleHash, uint256 sessionCommitment) internal view {
        uint256 registeredCommitment = handleSessionCommitments[handleHash];
        if (registeredCommitment == 0) revert HandleNotClaimed(handleHash);
        if (registeredCommitment != sessionCommitment) revert SessionDoesNotOwnHandle(handleHash);
    }

    function _validateRegistration(AgentRegistration calldata registration) internal view {
        if (
            registration.handleHash == bytes32(0) || registration.controllerAddress == address(0)
                || registration.agentAddress == address(0) || registration.scope == 0
                || registration.expiresAt < block.timestamp || registration.validFrom > registration.expiresAt
        ) revert InvalidRegistration();
    }

    function _requireActiveRegistration(bytes32 registrationHash, uint64 signedAt)
        internal
        view
        returns (StoredAgentRegistration memory registration)
    {
        registration = agentRegistrations[registrationHash];
        if (registration.agentAddress == address(0)) revert AgentNotRegistered(registrationHash);
        if (registration.revoked) revert AgentRevokedError(registrationHash);
        if (signedAt < registration.validFrom) revert AgentRegistrationNotYetValid(registrationHash);
        if (signedAt > registration.expiresAt || block.timestamp > registration.expiresAt) {
            revert AgentRegistrationExpired(registrationHash);
        }
        if (signedAt > block.timestamp) revert InvalidAgentSignature();
        if ((registration.scope & SCOPE_PUBLISH_DOCUMENT) == 0) revert InvalidRegistration();
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidAgentSignature();
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) {
            revert InvalidAgentSignature();
        }
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidAgentSignature();
        return signer;
    }

    function _toHexString(bytes32 value) internal pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory output = new bytes(66);
        output[0] = "0";
        output[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            uint8 char = uint8(value[i]);
            output[2 + i * 2] = alphabet[char >> 4];
            output[3 + i * 2] = alphabet[char & 0x0f];
        }
        return string(output);
    }
}
