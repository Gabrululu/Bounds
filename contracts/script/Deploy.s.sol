// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Script, console2} from "forge-std/Script.sol";

import {BoundsCREConsumer, ICRERevoker} from "../src/BoundsCREConsumer.sol";
import {
    Grant,
    IUserRegistry,
    IVerifiableFactory,
    RegistryRoles
} from "../src/interfaces/IENSv2.sol";
import {RobotRegistrar} from "../src/RobotRegistrar.sol";
import {Sepolia} from "./Sepolia.sol";

interface IETHRegistry {
    function setSubregistry(uint256 anyId, address registry) external;
}

/// @notice Deploys the robot subregistry, the registrar and the CRE consumer, and points the
///         parent name at the subregistry. The broadcaster must own the parent name.
/// @dev Env: ENS_PARENT_LABEL. Optional: CRE_FORWARDER (default: Chainlink's mock forwarder,
///      for simulation).
contract Deploy is Script {
    function run() external {
        string memory label = vm.envString("ENS_PARENT_LABEL");
        address forwarder = vm.envOr("CRE_FORWARDER", Sepolia.CRE_MOCK_FORWARDER);
        bytes32 parentHash = keccak256(bytes(label));
        bytes memory dnsParent = abi.encodePacked(uint8(bytes(label).length), label, uint8(3), "eth", uint8(0));

        uint256 robotRoleAdmins = uint256((1 << 40) | (1 << 44) | (1 << 48)) << 128;
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(
            msg.sender,
            RegistryRoles.ROLE_REGISTRAR | (RegistryRoles.ROLE_REGISTRAR << 128)
                | RegistryRoles.ROLE_UNREGISTER | (RegistryRoles.ROLE_UNREGISTER << 128)
                | RegistryRoles.ROLE_SET_PARENT | robotRoleAdmins
        );

        vm.startBroadcast();
        // No account gets ROLE_UPGRADE, so the subregistry cannot be upgraded.
        IUserRegistry registry = IUserRegistry(
            IVerifiableFactory(Sepolia.VERIFIABLE_FACTORY).deployProxy(
                Sepolia.USER_REGISTRY_IMPL,
                uint256(parentHash),
                abi.encodeCall(IUserRegistry.initialize, (grants))
            )
        );
        RobotRegistrar registrar = new RobotRegistrar(
            registry, IVerifiableFactory(Sepolia.VERIFIABLE_FACTORY), Sepolia.RESOLVER_IMPL, dnsParent, msg.sender
        );
        BoundsCREConsumer consumer = new BoundsCREConsumer(ICRERevoker(address(registrar)), forwarder, msg.sender);
        registrar.setRevoker(address(consumer));
        registry.grantRootRoles(
            RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER | robotRoleAdmins,
            address(registrar)
        );
        IETHRegistry(Sepolia.ETH_REGISTRY).setSubregistry(uint256(parentHash), address(registry));
        registry.setParent(Sepolia.ETH_REGISTRY, label);
        vm.stopBroadcast();

        console2.log("UserRegistry", address(registry));
        console2.log("RobotRegistrar", address(registrar));
        console2.log("BoundsCREConsumer", address(consumer));
    }
}
