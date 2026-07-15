// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IWorldIDVerifierV4 {
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

contract LibroAgentRegistry {
    struct WorldIdV4Proof {
        uint256 nullifier;
        uint256 nonce;
        uint64 expiresAtMin;
        uint64 issuerSchemaId;
        uint256 credentialGenesisIssuedAtMin;
        uint256[5] zeroKnowledgeProof;
    }

    struct AgentRegistration {
        bytes32 principalAuthorHash;
        address controllerAddress;
        address agentAddress;
        uint256 scope;
        uint64 validFrom;
        uint64 expiresAt;
        bytes32 salt;
    }

    struct StoredAgentRegistration {
        bytes32 principalAuthorHash;
        address controllerAddress;
        address agentAddress;
        uint256 scope;
        uint64 validFrom;
        uint64 expiresAt;
        bool revoked;
    }

    IWorldIDVerifierV4 public immutable worldIdVerifier;
    uint64 public immutable rpId;
    uint256 public immutable agentRegistrationActionHash;

    uint256 public constant SCOPE_PUBLISH_DOCUMENT = 1;

    bytes32 public constant AGENT_REGISTRATION_TYPEHASH = keccak256(
        "LibroAgentRegistration(bytes32 principalAuthorHash,address controllerAddress,address agentAddress,uint256 scope,uint64 validFrom,uint64 expiresAt,bytes32 salt,uint256 chainId,address registryAddress)"
    );
    bytes32 public constant AGENT_DOCUMENT_TYPEHASH = keccak256(
        "AgentDocument(bytes32 registrationHash,uint256 documentSignalHash,bytes32 documentNonce,uint64 signedAt)"
    );
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant NAME_HASH = keccak256("LibroAgentRegistry");
    bytes32 public constant VERSION_HASH = keccak256("1");

    mapping(bytes32 => StoredAgentRegistration) public agentRegistrations;
    mapping(uint256 => bytes32) private documentRegistrations;

    event AgentRegistered(
        bytes32 indexed registrationHash,
        bytes32 indexed principalAuthorHash,
        address indexed agentAddress,
        address controllerAddress,
        uint256 scope,
        uint64 expiresAt
    );
    event AgentRevoked(bytes32 indexed registrationHash);
    event AgentDocumentRegistered(
        uint256 indexed documentSignalHash,
        bytes32 indexed registrationHash,
        address indexed agentAddress,
        bytes32 documentNonce,
        uint64 signedAt
    );

    error InvalidVerifier();
    error InvalidRpId();
    error InvalidActionHash();
    error InvalidRegistration();
    error AgentAlreadyRegistered(bytes32 registrationHash);
    error AgentNotRegistered(bytes32 registrationHash);
    error AgentRegistrationExpired(bytes32 registrationHash);
    error AgentRegistrationNotYetValid(bytes32 registrationHash);
    error AgentRevokedError(bytes32 registrationHash);
    error UnauthorizedController();
    error InvalidDocumentSignalHash();
    error DocumentAlreadyRegistered(uint256 documentSignalHash);
    error InvalidAgentSignature();
    error InvalidSignatureLength();

    constructor(address _worldIdVerifier, uint64 _rpId, uint256 _agentRegistrationActionHash) {
        if (_worldIdVerifier == address(0)) revert InvalidVerifier();
        if (_rpId == 0) revert InvalidRpId();
        if (_agentRegistrationActionHash == 0) revert InvalidActionHash();

        worldIdVerifier = IWorldIDVerifierV4(_worldIdVerifier);
        rpId = _rpId;
        agentRegistrationActionHash = _agentRegistrationActionHash;
    }

    function registerAgent(AgentRegistration calldata registration, WorldIdV4Proof calldata proof) external {
        _validateRegistration(registration);

        bytes32 registrationHash = getAgentRegistrationHash(registration);
        if (agentRegistrations[registrationHash].agentAddress != address(0)) {
            revert AgentAlreadyRegistered(registrationHash);
        }

        worldIdVerifier.verify(
            proof.nullifier,
            agentRegistrationActionHash,
            rpId,
            proof.nonce,
            getAgentRegistrationSignalHash(registration),
            proof.expiresAtMin,
            proof.issuerSchemaId,
            proof.credentialGenesisIssuedAtMin,
            proof.zeroKnowledgeProof
        );

        agentRegistrations[registrationHash] = StoredAgentRegistration({
            principalAuthorHash: registration.principalAuthorHash,
            controllerAddress: registration.controllerAddress,
            agentAddress: registration.agentAddress,
            scope: registration.scope,
            validFrom: registration.validFrom,
            expiresAt: registration.expiresAt,
            revoked: false
        });

        emit AgentRegistered(
            registrationHash,
            registration.principalAuthorHash,
            registration.agentAddress,
            registration.controllerAddress,
            registration.scope,
            registration.expiresAt
        );
    }

    function revokeAgent(bytes32 registrationHash) external {
        StoredAgentRegistration storage registration = agentRegistrations[registrationHash];
        if (registration.agentAddress == address(0)) revert AgentNotRegistered(registrationHash);
        if (msg.sender != registration.controllerAddress) revert UnauthorizedController();
        if (registration.revoked) revert AgentRevokedError(registrationHash);

        registration.revoked = true;
        emit AgentRevoked(registrationHash);
    }

    function registerAgentDocument(
        bytes32 registrationHash,
        uint256 documentSignalHash,
        bytes32 documentNonce,
        uint64 signedAt,
        bytes calldata signature
    ) external {
        if (documentSignalHash == 0) revert InvalidDocumentSignalHash();
        if (documentRegistrations[documentSignalHash] != bytes32(0)) {
            revert DocumentAlreadyRegistered(documentSignalHash);
        }

        StoredAgentRegistration memory registration = _requireActiveRegistration(registrationHash, signedAt);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(AGENT_DOCUMENT_TYPEHASH, registrationHash, documentSignalHash, documentNonce, signedAt))
        );
        address signer = _recover(digest, signature);
        if (signer != registration.agentAddress) revert InvalidAgentSignature();

        documentRegistrations[documentSignalHash] = registrationHash;

        emit AgentDocumentRegistered(
            documentSignalHash,
            registrationHash,
            registration.agentAddress,
            documentNonce,
            signedAt
        );
    }

    function verifyAgent(bytes32 registrationHash) external view returns (bool) {
        StoredAgentRegistration memory registration = agentRegistrations[registrationHash];
        return registration.agentAddress != address(0)
            && !registration.revoked
            && registration.validFrom <= block.timestamp
            && block.timestamp <= registration.expiresAt;
    }

    function verifyAgentDocument(uint256 documentSignalHash) external view returns (bool) {
        bytes32 registrationHash = documentRegistrations[documentSignalHash];
        if (registrationHash == bytes32(0)) return false;
        StoredAgentRegistration memory registration = agentRegistrations[registrationHash];
        return registration.agentAddress != address(0) && !registration.revoked;
    }

    function documentRegistrationHash(uint256 documentSignalHash) external view returns (bytes32) {
        return documentRegistrations[documentSignalHash];
    }

    function getAgentRegistrationHash(AgentRegistration calldata registration) public view returns (bytes32) {
        return keccak256(_encodeRegistrationSignal(registration));
    }

    function getAgentRegistrationSignalHash(AgentRegistration calldata registration) public view returns (uint256) {
        return uint256(getAgentRegistrationHash(registration)) >> 8;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _validateRegistration(AgentRegistration calldata registration) internal view {
        if (
            registration.principalAuthorHash == bytes32(0)
                || registration.controllerAddress == address(0)
                || registration.agentAddress == address(0)
                || registration.scope == 0
                || registration.expiresAt < block.timestamp
                || registration.validFrom > registration.expiresAt
        ) {
            revert InvalidRegistration();
        }
    }

    function _requireActiveRegistration(bytes32 registrationHash, uint64 signedAt)
        internal
        view
        returns (StoredAgentRegistration memory)
    {
        StoredAgentRegistration memory registration = agentRegistrations[registrationHash];
        if (registration.agentAddress == address(0)) revert AgentNotRegistered(registrationHash);
        if (registration.revoked) revert AgentRevokedError(registrationHash);
        if (signedAt < registration.validFrom) revert AgentRegistrationNotYetValid(registrationHash);
        if (signedAt > registration.expiresAt || block.timestamp > registration.expiresAt) {
            revert AgentRegistrationExpired(registrationHash);
        }
        if (signedAt > block.timestamp) revert InvalidAgentSignature();
        if ((registration.scope & SCOPE_PUBLISH_DOCUMENT) == 0) revert InvalidRegistration();
        return registration;
    }

    function _encodeRegistrationSignal(AgentRegistration calldata registration) internal view returns (bytes memory) {
        return abi.encode(
            AGENT_REGISTRATION_TYPEHASH,
            registration.principalAuthorHash,
            registration.controllerAddress,
            registration.agentAddress,
            registration.scope,
            registration.validFrom,
            registration.expiresAt,
            registration.salt,
            block.chainid,
            address(this)
        );
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

        if (v < 27) {
            v += 27;
        }

        if (v != 27 && v != 28) revert InvalidAgentSignature();
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) {
            revert InvalidAgentSignature();
        }

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidAgentSignature();
        return signer;
    }
}
