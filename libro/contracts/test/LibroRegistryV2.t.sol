// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {LibroRegistry} from "../src/LibroRegistry.sol";
import {LibroRegistryV2} from "../src/LibroRegistryV2.sol";
import {MockWorldIDSessionVerifier, Vm} from "./LibroRegistry.t.sol";
interface VmV2 is Vm {
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function expectEmit(bool, bool, bool, bool) external;
}
contract LibroRegistryV2Test {
    VmV2 constant vm = VmV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 constant HANDLE = keccak256("alice_1");
    uint256 constant KEY = 0xB0B;
    MockWorldIDSessionVerifier verifier;
    LibroRegistry v1;
    LibroRegistryV2 v2;
    uint256 nonce;
    event PublicationUpdated(uint256 indexed previousSignalHash, uint256 indexed newSignalHash, bytes32 indexed handleHash, address previousRegistry, address rootRegistry, uint256 rootSignalHash, uint256 revisionNumber);
    function setUp() public {
        vm.chainId(480); vm.warp(100);
        verifier = new MockWorldIDSessionVerifier();
        v1 = new LibroRegistry(address(verifier),303);
        v2 = new LibroRegistryV2(address(v1),address(verifier),303);
        nonce = 909;
    }
    function proof() private view returns (LibroRegistryV2.WorldIdSessionProof memory) {
        return LibroRegistryV2.WorldIdSessionProof(808,404,505,606,707,[nonce,uint256(1010)],[uint256(1),2,3,4,5]);
    }
    function nextProof(uint256 signal) private {
        nonce++; verifier.setExpectedNullifier(nonce); verifier.setExpectedSignalHash(signal);
    }
    function claim() private {
        verifier.setExpectedSignalHash(v1.getHandleClaimSignalHash("alice_1"));
        v2.claimHandle("alice_1",proof());
    }
    function publication(address previous, uint256 hash, string memory text) private pure returns (LibroRegistryV2.PublicationCommitment memory) {
        return LibroRegistryV2.PublicationCommitment(keccak256(bytes(text)),previous,hash);
    }
    function human(LibroRegistryV2.PublicationCommitment memory value) private returns (uint256 hash) {
        hash = v2.getPublicationSignalHash(HANDLE,value,1); nextProof(hash);
        v2.registerHumanPublication(HANDLE,value,proof());
    }
    function fails(bytes memory data) private { (bool ok,) = address(v2).call(data); require(!ok,"expected revert"); }
    function testDualReservationAndImportArePermanent() public {
        claim(); require(v1.handleSessionCommitments(HANDLE)==808,"v1");
        require(v2.handleSessionCommitments(HANDLE)==808,"v2");
        v2.importHandle(HANDLE); require(v2.sessionCommitmentHandles(808)==HANDLE,"reverse binding");
        (bool ok,) = address(v1).call(abi.encodeCall(v1.claimHandle,("alice_1",LibroRegistry.WorldIdSessionProof(808,404,505,606,707,[nonce,uint256(1010)],[uint256(1),2,3,4,5]))));
        require(!ok,"v1 must reserve namespace");
    }
    function testInvalidClaimRollsBackBothRegistries() public {
        verifier.setShouldReject(true); fails(abi.encodeCall(v2.claimHandle,("alice_1",proof())));
        require(v1.handleSessionCommitments(HANDLE)==0 && v2.handleSessionCommitments(HANDLE)==0,"atomic claim");
    }
    function testV1HandleImportsWithoutNewProof() public {
        verifier.setExpectedSignalHash(v1.getHandleClaimSignalHash("alice_1"));
        v1.claimHandle("alice_1",LibroRegistry.WorldIdSessionProof(808,404,505,606,707,[nonce,uint256(1010)],[uint256(1),2,3,4,5]));
        v2.importHandle(HANDLE); require(v2.handleSessionCommitments(HANDLE)==808,"import");
    }
    function testConstructorRejectsInconsistentVerifierAndRp() public {
        try new LibroRegistryV2(address(v1),address(verifier),304) { revert("wrong rp"); } catch {}
        try new LibroRegistryV2(address(v1),address(1),303) { revert("wrong verifier"); } catch {}
        try new LibroRegistryV2(address(1),address(verifier),303) { revert("wrong registry"); } catch {}
    }
    function testUnknownHashIsNotLatestAndBadReferenceFails() public {
        require(!v2.getPublicationStatus(address(v2),123).isLatest,"unknown latest");
        fails(abi.encodeCall(v2.referenceV1Publication,(123)));
        fails(abi.encodeCall(v2.importHandle,(keccak256("unknown"))));
    }
    function testOriginalAndMultiStepHistory() public {
        claim(); uint256 first = human(publication(address(0),0,"one"));
        uint256 second = human(publication(address(v2),first,"two"));
        uint256 third = human(publication(address(v2),second,"three"));
        LibroRegistryV2.PublicationStatus memory status = v2.getPublicationStatus(address(v2),first);
        require(status.exists && !status.isLatest && status.next.signalHash==second,"first status");
        require(status.latest.signalHash==third && status.root.signalHash==first,"family");
        status = v2.getPublicationStatus(address(v2),third);
        require(status.isLatest && status.previous.signalHash==second && status.revisionNumber==3,"head");
    }
    function testV1ProvenanceAndUpdateEvent() public {
        claim(); uint256 first = 1111; nextProof(first);
        v1.registerHumanDocument(HANDLE,first,LibroRegistry.WorldIdSessionProof(808,404,505,606,707,[nonce,uint256(1010)],[uint256(1),2,3,4,5]));
        v2.referenceV1Publication(first); v2.referenceV1Publication(first);
        LibroRegistryV2.PublicationStatus memory old = v2.getPublicationStatus(address(v1),first);
        require(old.exists && old.isLatest && old.authorshipClass==1 && old.originalRegistry==address(v1),"provenance");
        LibroRegistryV2.PublicationCommitment memory value = publication(address(v1),first,"update");
        uint256 second = v2.getPublicationSignalHash(HANDLE,value,1); nextProof(second);
        vm.expectEmit(true,true,true,true);
        emit PublicationUpdated(first,second,HANDLE,address(v1),address(v1),first,2);
        v2.registerHumanPublication(HANDLE,value,proof());
        require(!v2.getPublicationStatus(address(v1),first).isLatest,"v1 successor");
    }
    function testCompetingUpdatesAndReplayFail() public {
        claim(); uint256 first = human(publication(address(0),0,"one"));
        uint256 second = human(publication(address(v2),first,"two"));
        fails(abi.encodeCall(v2.registerHumanPublication,(HANDLE,publication(address(v2),first,"competing"),proof())));
        fails(abi.encodeCall(v2.registerHumanPublication,(HANDLE,publication(address(v2),first,"two"),proof())));
        nextProof(v2.getPublicationSignalHash(HANDLE,publication(address(v2),second,"three"),1));
        LibroRegistryV2.WorldIdSessionProof memory wrong = proof(); wrong.sessionCommitment = 999;
        fails(abi.encodeCall(v2.registerHumanPublication,(HANDLE,publication(address(v2),second,"three"),wrong)));
        require(v2.getPublicationStatus(address(v2),second).isLatest,"failure advanced head");
    }
    function testInvalidPredecessorsAndProofTamperingFail() public {
        claim(); human(publication(address(0),0,"one"));
        fails(abi.encodeCall(v2.registerHumanPublication,(HANDLE,publication(address(0),1,"bad"),proof())));
        fails(abi.encodeCall(v2.registerHumanPublication,(HANDLE,publication(address(1),1,"bad"),proof())));
        fails(abi.encodeCall(v2.registerHumanPublication,(HANDLE,publication(address(v2),1,"missing"),proof())));
        nextProof(v2.getPublicationSignalHash(HANDLE,publication(address(0),0,"real"),1));
        fails(abi.encodeCall(v2.registerHumanPublication,(HANDLE,publication(address(0),0,"tampered"),proof())));
        require(!v2.getPublicationStatus(address(v2),v2.getPublicationSignalHash(HANDLE,publication(address(0),0,"tampered"),1)).exists,"failed proof persisted");
    }
    function grant() private returns (bytes32 hash) {
        LibroRegistryV2.AgentRegistration memory value = LibroRegistryV2.AgentRegistration(HANDLE,address(this),vm.addr(KEY),1,100,1000,keccak256("grant"));
        nextProof(v2.getAgentRegistrationSignalHash(value)); v2.registerAgent(value,proof());
        return v2.getAgentRegistrationHash(value);
    }
    function agent(bytes32 registration, LibroRegistryV2.PublicationCommitment memory value) private returns (uint256 hash) {
        hash = v2.getPublicationSignalHash(HANDLE,value,2);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01",v2.domainSeparator(),keccak256(abi.encode(v2.AGENT_DOCUMENT_TYPEHASH(),registration,hash,keccak256("doc"),uint64(100)))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY,digest);
        v2.registerAgentPublication(registration,value,keccak256("doc"),100,abi.encodePacked(r,s,v));
    }
    function testFreshAgentGrantRevisionsAndRevocation() public {
        claim(); bytes32 registration = grant();
        uint256 first = agent(registration,publication(address(0),0,"one"));
        uint256 second = agent(registration,publication(address(v2),first,"two"));
        require(v2.getPublicationStatus(address(v2),second).isLatest,"agent head");
        require(v2.verifyAgentDocument(second,HANDLE),"agent verification");
        v2.revokeAgent(registration); require(!v2.verifyAgentDocument(second,HANDLE),"revocation");
        fails(abi.encodeCall(v2.registerAgentPublication,(registration,publication(address(v2),second,"revoked"),keccak256("doc"),uint64(100),bytes(""))));
    }
    function testAgentCannotReplaceHuman() public {
        claim(); bytes32 registration = grant(); uint256 first = human(publication(address(0),0,"human"));
        LibroRegistryV2.PublicationCommitment memory value = publication(address(v2),first,"agent");
        uint256 hash = v2.getPublicationSignalHash(HANDLE,value,2);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01",v2.domainSeparator(),keccak256(abi.encode(v2.AGENT_DOCUMENT_TYPEHASH(),registration,hash,keccak256("doc"),uint64(100)))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY,digest);
        fails(abi.encodeCall(v2.registerAgentPublication,(registration,value,keccak256("doc"),uint64(100),abi.encodePacked(r,s,v))));
        require(v2.getPublicationStatus(address(v2),first).isLatest,"human overwritten");
    }

    function testV1AgentProvenanceRequiresValidRegistrationAndFreshV2Grant() public {
        claim();
        LibroRegistry.AgentRegistration memory value = LibroRegistry.AgentRegistration(HANDLE,address(this),vm.addr(KEY),1,100,1000,keccak256("v1 grant"));
        nextProof(v1.getAgentRegistrationSignalHash(value));
        v1.registerAgent(value,LibroRegistry.WorldIdSessionProof(808,404,505,606,707,[nonce,uint256(1010)],[uint256(1),2,3,4,5]));
        bytes32 registration = v1.getAgentRegistrationHash(value);
        require(!v2.verifyAgent(registration,HANDLE),"v1 grant imported");
        fails(abi.encodeCall(v2.registerAgentPublication,(registration,publication(address(0),0,"new"),keccak256("doc"),uint64(100),bytes(""))));
        uint256 document = 7777;
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01",v1.domainSeparator(),keccak256(abi.encode(v1.AGENT_DOCUMENT_TYPEHASH(),registration,document,keccak256("doc"),uint64(100)))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY,digest);
        v1.registerAgentDocument(registration,document,keccak256("doc"),100,abi.encodePacked(r,s,v));
        v2.referenceV1Publication(document);
        require(v2.getPublicationStatus(address(v1),document).authorshipClass==2,"agent provenance class");
        uint256 successor = agent(grant(),publication(address(v1),document,"updated"));
        require(v2.getPublicationStatus(address(v1),document).latest.signalHash==successor,"v1 agent successor");
        v1.revokeAgent(registration);
        require(!v1.verifyAgentDocument(document,HANDLE),"v1 revocation");
        require(v2.getPublicationStatus(address(v1),document).exists,"recorded provenance lost");
    }

    function testCommitmentSeparatesHandleClassPredecessorChainAndRegistry() public {
        LibroRegistryV2.PublicationCommitment memory value = publication(address(0),0,"content");
        uint256 signal = v2.getPublicationSignalHash(HANDLE,value,1);
        require(signal!=v2.getPublicationSignalHash(keccak256("bob_2"),value,1),"handle domain");
        require(signal!=v2.getPublicationSignalHash(HANDLE,value,2),"class domain");
        require(signal!=v2.getPublicationSignalHash(HANDLE,publication(address(v1),7777,"content"),1),"predecessor domain");
        LibroRegistryV2 other = new LibroRegistryV2(address(v1),address(verifier),303);
        require(signal!=other.getPublicationSignalHash(HANDLE,value,1),"registry domain");
        vm.chainId(481);
        require(signal!=v2.getPublicationSignalHash(HANDLE,value,1),"chain domain");
    }

    function testSharedTypeScriptGoldenVectors() public {
        address target = address(0x2222222222222222222222222222222222222222);
        vm.etch(target,address(v2).code);
        LibroRegistryV2 golden = LibroRegistryV2(target);
        require(golden.getPublicationSignalHash(0x24594aaefd000e9143d29865ad2d4b1f7dd92f11bfe9f1700101dc459f655501, LibroRegistryV2.PublicationCommitment(0x86ebc0121530d398629772c2e276d4fdbe0a2e9cae314daceebfde90ac4093e9,address(0x0000000000000000000000000000000000000000),0),1) == 0x005dfdc39ed9369a118e0704172346dc017015ac300c5ff3ea8ca20103712b7c,"golden vector");
        require(golden.getPublicationSignalHash(0x24594aaefd000e9143d29865ad2d4b1f7dd92f11bfe9f1700101dc459f655501, LibroRegistryV2.PublicationCommitment(0xaa088e40a384e7f3baee24b51efe8f1bac7d55f1fa694d1c5ebd5d97ce046fc6,address(0x1111111111111111111111111111111111111111),1111),1) == 0x00f051e5c18d515d62c2a34ffc2a20c4df512db9325712789afd3a22b13b454f,"golden vector");
        require(golden.getPublicationSignalHash(0x24594aaefd000e9143d29865ad2d4b1f7dd92f11bfe9f1700101dc459f655501, LibroRegistryV2.PublicationCommitment(0xd2c559a2ef0ec3925a153ec12f5047fc8dc1aaf184bdc4f0dca7dca4f2e42fe0,address(0x2222222222222222222222222222222222222222),1212),2) == 0x00e5fd26a99320b6d292d788e8e65ed3203b4508f35846bc85b2338c8ac970bc,"golden vector");
    }
}
