// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {LibroRegistryV2} from "../src/LibroRegistryV2.sol";
interface DeploymentVm {
    function envAddress(string calldata) external returns (address);
    function envUint(string calldata) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}
contract DeployV2 {
    DeploymentVm constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function run() external returns (LibroRegistryV2 registry) {
        require(block.chainid == 480,"World Chain required");
        address v1 = vm.envAddress("NEXT_PUBLIC_LIBRO_V1_REGISTRY_ADDRESS");
        address verifier = vm.envAddress("WORLD_ID_VERIFIER_PROXY_ADDRESS");
        uint256 rp = vm.envUint("LIBRO_RP_ID_UINT64");
        require(rp > 0 && rp <= type(uint64).max,"invalid rp id");
        vm.startBroadcast();
        registry = new LibroRegistryV2(v1,verifier,uint64(rp));
        vm.stopBroadcast();
    }
}
