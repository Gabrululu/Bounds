// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Script, console2} from "forge-std/Script.sol";

import {EvidenceAnchor} from "../src/EvidenceAnchor.sol";

/// @notice Deploys EvidenceAnchor on 0G Galileo, next to the storage it points at. The owner must
///         be the wallet behind ZEROG_PRIVATE_KEY, because the /episode function anchors with it.
/// @dev Optional env: ANCHOR_OWNER (default: the broadcaster).
contract DeployAnchor is Script {
    function run() external {
        address owner = vm.envOr("ANCHOR_OWNER", msg.sender);
        vm.startBroadcast();
        EvidenceAnchor anchor = new EvidenceAnchor(owner);
        vm.stopBroadcast();
        console2.log("EvidenceAnchor", address(anchor));
    }
}
