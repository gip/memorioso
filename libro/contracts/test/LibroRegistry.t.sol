// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LibroRegistry, IWorldIDVerifier} from "../src/LibroRegistry.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract MockWorldIDSessionVerifier is IWorldIDVerifier {
    uint64 public expectedRpId = 303;
    uint256 public expectedNonce = 404;
    uint256 public expectedSignalHash;
    uint64 public expectedExpiresAtMin = 505;
    uint64 public expectedIssuerSchemaId = 606;
    uint256 public expectedCredentialGenesisIssuedAtMin = 707;
    uint256 public expectedSessionCommitment = 808;
    uint256[2] public expectedSessionNullifier = [uint256(909), uint256(1_010)];
    uint256[5] public expectedProof = [uint256(1), uint256(2), uint256(3), uint256(4), uint256(5)];
    bool public shouldReject;

    function setExpectedSignalHash(uint256 value) external { expectedSignalHash = value; }
    function setExpectedSessionCommitment(uint256 value) external { expectedSessionCommitment = value; }
    function setExpectedNullifier(uint256 value) external { expectedSessionNullifier[0] = value; }
    function setShouldReject(bool value) external { shouldReject = value; }

    function verifySession(
        uint64 rpId,
        uint256 nonce,
        uint256 signalHash,
        uint64 expiresAtMin,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        uint256 sessionId,
        uint256[2] calldata sessionNullifier,
        uint256[5] calldata zeroKnowledgeProof
    ) external view {
        require(!shouldReject, "mock reject");
        require(rpId == expectedRpId, "rpId");
        require(nonce == expectedNonce, "nonce");
        require(signalHash == expectedSignalHash, "signalHash");
        require(expiresAtMin == expectedExpiresAtMin, "expiresAtMin");
        require(issuerSchemaId == expectedIssuerSchemaId, "issuerSchemaId");
        require(credentialGenesisIssuedAtMin == expectedCredentialGenesisIssuedAtMin, "genesis");
        require(sessionId == expectedSessionCommitment, "session");
        require(sessionNullifier[0] == expectedSessionNullifier[0], "nullifier");
        require(sessionNullifier[1] == expectedSessionNullifier[1], "action");
        for (uint256 i; i < 5; i++) require(zeroKnowledgeProof[i] == expectedProof[i], "proof");
    }
}

contract LibroRegistryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant PERMIT_SIGNER_KEY = 0xA11CE;
    uint256 private constant AGENT_KEY = 0xB0B;
    uint256 private constant SESSION = 808;
    string private constant HANDLE = "alice_1";

    MockWorldIDSessionVerifier private verifier;
    LibroRegistry private registry;
    address private permitSigner;
    address private agent;

    function setUp() public {
        vm.warp(100);
        permitSigner = vm.addr(PERMIT_SIGNER_KEY);
        agent = vm.addr(AGENT_KEY);
        verifier = new MockWorldIDSessionVerifier();
        registry = new LibroRegistry(address(verifier), 303, permitSigner, address(this));
    }

    function proof(uint256 session, uint256 nullifier)
        private
        pure
        returns (LibroRegistry.WorldIdSessionProof memory)
    {
        return LibroRegistry.WorldIdSessionProof({
            sessionCommitment: session,
            nonce: 404,
            expiresAtMin: 505,
            issuerSchemaId: 606,
            credentialGenesisIssuedAtMin: 707,
            sessionNullifier: [nullifier, uint256(1_010)],
            zeroKnowledgeProof: [uint256(1), uint256(2), uint256(3), uint256(4), uint256(5)]
        });
    }

    function permitFor(string memory handle, uint256 session, bytes32 nonce, uint64 deadline, uint256 key)
        private
        returns (LibroRegistry.HandleClaimPermit memory)
    {
        bytes32 handleHash = keccak256(bytes(handle));
        bytes32 structHash = keccak256(abi.encode(
            registry.HANDLE_CLAIM_TYPEHASH(),
            handleHash,
            session,
            nonce,
            deadline,
            block.chainid,
            address(registry)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return LibroRegistry.HandleClaimPermit({nonce: nonce, deadline: deadline, signature: abi.encodePacked(r, s, v)});
    }

    function validPermit() private returns (LibroRegistry.HandleClaimPermit memory) {
        return permitFor(HANDLE, SESSION, keccak256("permit-1"), 1_000, PERMIT_SIGNER_KEY);
    }

    function claim() private {
        verifier.setExpectedSignalHash(registry.getHandleClaimSignalHash(HANDLE));
        registry.claimHandle(HANDLE, proof(SESSION, 909), validPermit());
    }

    function expectRevertCall(bytes memory callData, string memory message) private {
        (bool ok,) = address(registry).call(callData);
        require(!ok, message);
    }

    function testValidClaimCreatesPermanentBidirectionalBinding() public {
        setUp();
        claim();
        bytes32 handleHash = keccak256(bytes(HANDLE));
        require(registry.handleSessionCommitments(handleHash) == SESSION, "handle mapping");
        require(registry.sessionCommitmentHandles(SESSION) == handleHash, "session mapping");
    }

    function testRejectsInvalidNormalization() public {
        setUp();
        expectRevertCall(
            abi.encodeCall(registry.claimHandle, ("Alice", proof(SESSION, 909), validPermit())),
            "uppercase handle accepted"
        );
        expectRevertCall(
            abi.encodeCall(registry.claimHandle, ("ab", proof(SESSION, 909), validPermit())),
            "short handle accepted"
        );
    }

    function testRejectsExpiredWrongAndReplayedPermit() public {
        setUp();
        LibroRegistry.HandleClaimPermit memory expired = permitFor(
            HANDLE, SESSION, keccak256("expired"), 99, PERMIT_SIGNER_KEY
        );
        expectRevertCall(
            abi.encodeCall(registry.claimHandle, (HANDLE, proof(SESSION, 909), expired)),
            "expired permit accepted"
        );

        LibroRegistry.HandleClaimPermit memory wrong = permitFor(
            HANDLE, SESSION, keccak256("wrong"), 1_000, 0xBAD
        );
        expectRevertCall(
            abi.encodeCall(registry.claimHandle, (HANDLE, proof(SESSION, 909), wrong)),
            "wrong permit accepted"
        );

        claim();
        expectRevertCall(
            abi.encodeCall(registry.claimHandle, (HANDLE, proof(SESSION, 909), validPermit())),
            "claimed handle accepted"
        );
    }

    function testRejectsDuplicateHandleAndDuplicateSession() public {
        setUp();
        claim();
        verifier.setExpectedNullifier(910);
        verifier.setExpectedSignalHash(registry.getHandleClaimSignalHash("alice_2"));
        expectRevertCall(
            abi.encodeCall(
                registry.claimHandle,
                ("alice_2", proof(SESSION, 910), permitFor("alice_2", SESSION, keccak256("permit-2"), 1_000, PERMIT_SIGNER_KEY))
            ),
            "duplicate session accepted"
        );
    }

    function testAtomicClaimAndPublication() public {
        setUp();
        uint256 signalHash = 1_111;
        verifier.setExpectedSignalHash(signalHash);
        registry.claimHandleAndRegisterHumanDocument(HANDLE, signalHash, proof(SESSION, 909), validPermit());
        bytes32 handleHash = keccak256(bytes(HANDLE));
        require(registry.verifyHumanDocument(signalHash, handleHash), "document missing");
    }

    function testAtomicClaimRollsBackWhenVerifierRejects() public {
        setUp();
        verifier.setExpectedSignalHash(1_111);
        verifier.setShouldReject(true);
        expectRevertCall(
            abi.encodeCall(
                registry.claimHandleAndRegisterHumanDocument,
                (HANDLE, 1_111, proof(SESSION, 909), validPermit())
            ),
            "rejected proof accepted"
        );
        require(registry.handleSessionCommitments(keccak256(bytes(HANDLE))) == 0, "claim did not roll back");
    }

    function testPublicationRejectsOtherSessionSubstitutedHandleSignalAndNullifierReuse() public {
        setUp();
        claim();
        bytes32 handleHash = keccak256(bytes(HANDLE));

        verifier.setExpectedSignalHash(1_111);
        verifier.setExpectedNullifier(910);
        registry.registerHumanDocument(handleHash, 1_111, proof(SESSION, 910));

        expectRevertCall(
            abi.encodeCall(registry.registerHumanDocument, (handleHash, 1_112, proof(SESSION, 910))),
            "nullifier reuse accepted"
        );

        verifier.setExpectedSessionCommitment(999);
        verifier.setExpectedNullifier(911);
        verifier.setExpectedSignalHash(1_113);
        expectRevertCall(
            abi.encodeCall(registry.registerHumanDocument, (handleHash, 1_113, proof(999, 911))),
            "other session accepted"
        );

        expectRevertCall(
            abi.encodeCall(registry.registerHumanDocument, (keccak256("other"), 1_113, proof(999, 911))),
            "unclaimed handle accepted"
        );

        verifier.setExpectedSessionCommitment(SESSION);
        expectRevertCall(
            abi.encodeCall(registry.registerHumanDocument, (handleHash, 1_114, proof(SESSION, 911))),
            "substituted signal accepted"
        );
    }

    function registration(bytes32 handleHash) private view returns (LibroRegistry.AgentRegistration memory) {
        return LibroRegistry.AgentRegistration({
            handleHash: handleHash,
            controllerAddress: address(this),
            agentAddress: agent,
            scope: registry.SCOPE_PUBLISH_DOCUMENT(),
            validFrom: 100,
            expiresAt: 1_000,
            salt: keccak256("agent")
        });
    }

    function signAgentDocument(bytes32 registrationHash, uint256 signalHash, bytes32 nonce, uint64 signedAt)
        private
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            registry.AGENT_DOCUMENT_TYPEHASH(), registrationHash, signalHash, nonce, signedAt
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function testAgentAuthorizationAndDocumentsStayBoundToHandle() public {
        setUp();
        claim();
        bytes32 handleHash = keccak256(bytes(HANDLE));
        LibroRegistry.AgentRegistration memory value = registration(handleHash);
        verifier.setExpectedSignalHash(registry.getAgentRegistrationSignalHash(value));
        verifier.setExpectedNullifier(910);
        registry.registerAgent(value, proof(SESSION, 910));
        bytes32 registrationHash = registry.getAgentRegistrationHash(value);

        uint256 documentHash = 1_212;
        bytes32 nonce = keccak256("document");
        registry.registerAgentDocument(
            registrationHash, documentHash, nonce, 100,
            signAgentDocument(registrationHash, documentHash, nonce, 100)
        );
        require(registry.verifyAgentDocument(documentHash, handleHash), "agent document missing");
        require(!registry.verifyAgentDocument(documentHash, keccak256("other")), "agent claimed other handle");

        registry.revokeAgent(registrationHash);
        require(!registry.verifyAgentDocument(documentHash, handleHash), "revoked agent still valid");
    }

    function testPermitSignerRotationAndTwoStepOwnership() public {
        setUp();
        address newSigner = vm.addr(0xCAFE);
        registry.setHandlePermitSigner(newSigner);
        require(registry.handlePermitSigner() == newSigner, "signer not rotated");

        address newOwner = vm.addr(0xD00D);
        registry.transferOwnership(newOwner);
        expectRevertCall(abi.encodeCall(registry.acceptOwnership, ()), "non-pending owner accepted");
        vm.prank(newOwner);
        registry.acceptOwnership();
        require(registry.owner() == newOwner, "ownership not accepted");
    }
}
