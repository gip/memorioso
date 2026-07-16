// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LibroProofRegistry, IWorldIDVerifier} from "../src/LibroProofRegistry.sol";

contract MockWorldIDVerifier is IWorldIDVerifier {
    uint256 public expectedNullifier = 101;
    uint256 public expectedAction = 202;
    uint64 public expectedRpId = 303;
    uint256 public expectedNonce = 404;
    uint64 public expectedExpiresAtMin = 505;
    uint64 public expectedIssuerSchemaId = 606;
    uint256 public expectedCredentialGenesisIssuedAtMin = 707;
    uint256 public expectedSignalHash;
    uint256[5] public expectedProof;
    bool public shouldReject;

    constructor() {
        expectedSignalHash = 808;
        expectedProof = [uint256(1), uint256(2), uint256(3), uint256(4), uint256(5)];
    }

    function setExpectedSignalHash(uint256 signalHash) external {
        expectedSignalHash = signalHash;
    }

    function setExpectedAction(uint256 action) external {
        expectedAction = action;
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

contract LibroProofRegistryTest {
    MockWorldIDVerifier private verifier;
    LibroProofRegistry private registry;

    function setUp() public {
        verifier = new MockWorldIDVerifier();
        registry = new LibroProofRegistry(address(verifier), 303);
    }

    function validProof() private pure returns (LibroProofRegistry.WorldIdV4Proof memory) {
        return LibroProofRegistry.WorldIdV4Proof({
            nullifier: 101,
            nonce: 404,
            expiresAtMin: 505,
            issuerSchemaId: 606,
            credentialGenesisIssuedAtMin: 707,
            zeroKnowledgeProof: [uint256(1), uint256(2), uint256(3), uint256(4), uint256(5)]
        });
    }

    function testVerifyReturnsFalseBeforeRegistration() public {
        setUp();

        require(!registry.verify(808), "signal unexpectedly registered");
    }

    function testRegisterValidProof() public {
        setUp();

        registry.register(808, 202, validProof());

        require(registry.verify(808), "signal was not registered");
    }

    function testDuplicateSignalReverts() public {
        setUp();
        registry.register(808, 202, validProof());

        bool reverted;
        try registry.register(808, 202, validProof()) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "duplicate signal did not revert");
    }

    function testSameNullifierCanRegisterDifferentSignal() public {
        setUp();
        registry.register(808, 202, validProof());

        verifier.setExpectedSignalHash(909);
        registry.register(909, 202, validProof());

        require(registry.verify(808), "first signal missing");
        require(registry.verify(909), "second signal missing");
    }

    function testRejectedVerifierDoesNotRegister() public {
        setUp();
        verifier.setShouldReject(true);

        bool reverted;
        try registry.register(808, 202, validProof()) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "verifier rejection did not revert");
        require(!registry.verify(808), "rejected signal registered");
    }

    function testZeroActionHashReverts() public {
        setUp();

        bool reverted;
        try registry.register(808, 0, validProof()) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "zero action did not revert");
        require(!registry.verify(808), "zero action signal registered");
    }

    function testDifferentActionHashIsPassedToVerifier() public {
        setUp();

        verifier.setExpectedAction(9090);
        registry.register(808, 9090, validProof());

        require(registry.verify(808), "signal was not registered");
    }
}
