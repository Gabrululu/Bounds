// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Script, console2} from "forge-std/Script.sol";

import {RobotRegistrar} from "../src/RobotRegistrar.sol";

/// @notice Creates three demo robots, one of them revoked. Everything lands on chain: the app
///         reads these licenses back and holds no demo data of its own.
/// @dev Robot addresses come from ROBOT_01, ROBOT_02 and ROBOT_03. If unset, addresses are derived
///      from the label: nobody holds their keys, which is fine for a robot that is only licensed.
///      Optional: LEASE_SECONDS (default 30 days), DEPLOYMENTS_FILE.
contract Seed is Script {
    function run() external {
        string memory file = vm.envOr("DEPLOYMENTS_FILE", string("../deployments/sepolia.json"));
        RobotRegistrar registrar = RobotRegistrar(vm.parseJsonAddress(vm.readFile(file), ".robotRegistrar"));
        uint64 expiry = uint64(block.timestamp + vm.envOr("LEASE_SECONDS", uint256(30 days)));

        vm.startBroadcast();
        // Permission bits: move = 1, manipulate = 2, enter-shared-area = 4. Zones match the app.
        registrar.grantLicense("robot-01", _robot("ROBOT_01", "robot-01"), keccak256("cell-a"), expiry, 1 | 2);
        registrar.grantLicense("robot-02", _robot("ROBOT_02", "robot-02"), keccak256("dock-1"), expiry, 1 | 4);
        registrar.grantLicense("robot-03", _robot("ROBOT_03", "robot-03"), keccak256("wh-3"), expiry, 1);
        // These robots are simulated, and their records say so.
        registrar.setAgentRecord("robot-01", "bounds.model", "Simulated robot");
        registrar.setAgentRecord("robot-02", "bounds.model", "Simulated robot");
        registrar.setAgentRecord("robot-03", "bounds.model", "Simulated robot");
        registrar.revokeLicense("robot-03", "OPERATOR_DEMO", "operator");
        vm.stopBroadcast();

        console2.log("Seeded robot-01, robot-02 and robot-03 (revoked) on", address(registrar));
    }

    function _robot(string memory envName, string memory label) internal view returns (address) {
        return vm.envOr(envName, address(uint160(uint256(keccak256(abi.encode("bounds.robot", label))))));
    }
}
