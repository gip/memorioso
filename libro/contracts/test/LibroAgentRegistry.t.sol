// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LibroAgentRegistry, IWorldIDVerifierV4} from "../src/LibroAgentRegistry.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function prank(address msgSender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract MockWorldIDVerifierV4 is IWorldIDVerifierV4 {
    uint256 public expectedNullifier = 101;
    uint256 public expectedAction;
    uint64 public expectedRpId;
    uint256 public expectedNonce = 404;
    uint256 public expectedSignalHash;
    uint64 public expectedExpiresAtMin = 505;
    uint64 public expectedIssuerSchemaId = 606;
    uint256 public expectedCredentialGenesisIssuedAtMin = 707;
    uint256[5] public expectedProof;
    bool public shouldReject;

    constructor(uint256 action, uint64 rpId) {
        expectedAction = action;
        expectedRpId = rpId;
        expectedProof = [uint256(1), uint256(2), uint256(3), uint256(4), uint256(5)];
    }

    function setExpectedSignalHash(uint256 signalHash) external {
        expectedSignalHash = signalHash;
    }

    function setShouldReject(bool value) external {
        shouldReject = value;
    }

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
    ) external view {
        require(!shouldReject, "mock reject");
        require(nullifier == expectedNullifier, "nullifier");
        require(action == expectedAction, "action");
        require(rpId == expectedRpId, "rpId");
        require(nonce == expectedNonce, "nonce");
        require(signalHash == expectedSignalHash, "signalHash");
        require(expiresAtMin == expectedExpiresAtMin, "expiresAtMin");
        require(issuerSchemaId == expectedIssuerSchemaId, "issuerSchemaId");
        require(
            credentialGenesisIssuedAtMin == expectedCredentialGenesisIssuedAtMin,
            "credentialGenesisIssuedAtMin"
        );

        for (uint256 i = 0; i < zeroKnowledgeProof.length; i++) {
            require(zeroKnowledgeProof[i] == expectedProof[i], "proof");
        }
    }
}

contract LibroAgentRegistryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ACTION_HASH = 202;
    uint64 private constant RP_ID = 303;
    uint256 private constant AGENT_KEY = 0xA11CE;
    uint256 private constant WRONG_AGENT_KEY = 0xB0B;

    MockWorldIDVerifierV4 private verifier;
    LibroAgentRegistry private registry;
    address private controller;
    address private agent;

    function setUp() public {
        vm.warp(100);
        verifier = new MockWorldIDVerifierV4(ACTION_HASH, RP_ID);
        registry = new LibroAgentRegistry(address(verifier), RP_ID, ACTION_HASH);
        controller = address(0xC0117);
        agent = vm.addr(AGENT_KEY);
    }

    function validRegistration() private view returns (LibroAgentRegistry.AgentRegistration memory) {
        return LibroAgentRegistry.AgentRegistration({
            principalAuthorHash: keccak256("author"),
            controllerAddress: controller,
            agentAddress: agent,
            scope: registry.SCOPE_PUBLISH_DOCUMENT(),
            validFrom: 100,
            expiresAt: 1_000,
            salt: keccak256("salt")
        });
    }

    function validProof() private pure returns (LibroAgentRegistry.WorldIdV4Proof memory) {
        return LibroAgentRegistry.WorldIdV4Proof({
            nullifier: 101,
            nonce: 404,
            expiresAtMin: 505,
            issuerSchemaId: 606,
            credentialGenesisIssuedAtMin: 707,
            zeroKnowledgeProof: [uint256(1), uint256(2), uint256(3), uint256(4), uint256(5)]
        });
    }

    function registerValidAgent() private returns (bytes32) {
        LibroAgentRegistry.AgentRegistration memory registration = validRegistration();
        verifier.setExpectedSignalHash(registry.getAgentRegistrationSignalHash(registration));
        registry.registerAgent(registration, validProof());
        return registry.getAgentRegistrationHash(registration);
    }

    function documentSignature(bytes32 registrationHash, uint256 documentSignalHash, bytes32 documentNonce, uint64 signedAt)
        private
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(registry.AGENT_DOCUMENT_TYPEHASH(), registrationHash, documentSignalHash, documentNonce, signedAt)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function wrongDocumentSignature(
        bytes32 registrationHash,
        uint256 documentSignalHash,
        bytes32 documentNonce,
        uint64 signedAt
    ) private returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(registry.AGENT_DOCUMENT_TYPEHASH(), registrationHash, documentSignalHash, documentNonce, signedAt)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(WRONG_AGENT_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function testRegisterAgentWithValidWorldIdProof() public {
        setUp();

        bytes32 registrationHash = registerValidAgent();

        require(registry.verifyAgent(registrationHash), "agent was not registered");
    }

    function testRejectedWorldIdProofDoesNotRegisterAgent() public {
        setUp();
        LibroAgentRegistry.AgentRegistration memory registration = validRegistration();
        verifier.setExpectedSignalHash(registry.getAgentRegistrationSignalHash(registration));
        verifier.setShouldReject(true);

        bool reverted;
        try registry.registerAgent(registration, validProof()) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "verifier rejection did not revert");
        require(!registry.verifyAgent(registry.getAgentRegistrationHash(registration)), "rejected agent registered");
    }

    function testRegisterAgentDocumentWithValidSignature() public {
        setUp();
        bytes32 registrationHash = registerValidAgent();
        uint256 documentSignalHash = 808;
        bytes32 documentNonce = keccak256("document nonce");
        uint64 signedAt = 100;

        registry.registerAgentDocument(
            registrationHash,
            documentSignalHash,
            documentNonce,
            signedAt,
            documentSignature(registrationHash, documentSignalHash, documentNonce, signedAt)
        );

        require(registry.verifyAgentDocument(documentSignalHash), "document was not registered");
        require(registry.documentRegistrationHash(documentSignalHash) == registrationHash, "wrong registration hash");
    }

    function testWrongAgentSignatureReverts() public {
        setUp();
        bytes32 registrationHash = registerValidAgent();
        uint256 documentSignalHash = 808;
        bytes32 documentNonce = keccak256("document nonce");
        uint64 signedAt = 100;

        bool reverted;
        try registry.registerAgentDocument(
            registrationHash,
            documentSignalHash,
            documentNonce,
            signedAt,
            wrongDocumentSignature(registrationHash, documentSignalHash, documentNonce, signedAt)
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "wrong signature did not revert");
    }

    function testDuplicateDocumentReverts() public {
        setUp();
        bytes32 registrationHash = registerValidAgent();
        uint256 documentSignalHash = 808;
        bytes32 documentNonce = keccak256("document nonce");
        uint64 signedAt = 100;
        bytes memory signature = documentSignature(registrationHash, documentSignalHash, documentNonce, signedAt);
        registry.registerAgentDocument(registrationHash, documentSignalHash, documentNonce, signedAt, signature);

        bool reverted;
        try registry.registerAgentDocument(registrationHash, documentSignalHash, documentNonce, signedAt, signature) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "duplicate document did not revert");
    }

    function testRevokedAgentCannotRegisterDocuments() public {
        setUp();
        bytes32 registrationHash = registerValidAgent();
        vm.prank(controller);
        registry.revokeAgent(registrationHash);

        uint256 documentSignalHash = 808;
        bytes32 documentNonce = keccak256("document nonce");
        uint64 signedAt = 100;

        bool reverted;
        try registry.registerAgentDocument(
            registrationHash,
            documentSignalHash,
            documentNonce,
            signedAt,
            documentSignature(registrationHash, documentSignalHash, documentNonce, signedAt)
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "revoked agent document did not revert");
    }

    function testExpiredAgentCannotRegisterDocuments() public {
        setUp();
        bytes32 registrationHash = registerValidAgent();
        vm.warp(1_001);

        uint256 documentSignalHash = 808;
        bytes32 documentNonce = keccak256("document nonce");
        uint64 signedAt = 100;

        bool reverted;
        try registry.registerAgentDocument(
            registrationHash,
            documentSignalHash,
            documentNonce,
            signedAt,
            documentSignature(registrationHash, documentSignalHash, documentNonce, signedAt)
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "expired agent document did not revert");
    }
}
