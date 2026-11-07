// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Script, console2} from "forge-std/Script.sol";

import {Sepolia} from "./Sepolia.sol";

interface IERC20Mintable {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IETHRegistrar {
    function commit(bytes32 commitment) external;
    function makeCommitment(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        bytes32 referrer
    ) external pure returns (bytes32);
    function register(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        address paymentToken,
        bytes32 referrer
    ) external returns (uint256);
    function isAvailable(string calldata label) external view returns (bool);
}

/// @notice Registers the parent .eth name on ENSv2 Sepolia, paying in the public MockUSDC.
/// @dev Run `commit()`, wait over a minute, then run `register()` with the same env.
contract RegisterParent is Script {
    uint64 internal constant DURATION = 365 days;

    function commit() external {
        string memory label = vm.envString("ENS_PARENT_LABEL");
        require(IETHRegistrar(Sepolia.ETH_REGISTRAR).isAvailable(label), "name is not available");
        vm.startBroadcast();
        IETHRegistrar(Sepolia.ETH_REGISTRAR).commit(_commitment(label, msg.sender));
        vm.stopBroadcast();
        console2.log("Committed. Wait 60 seconds, then run register().");
    }

    function register() external {
        string memory label = vm.envString("ENS_PARENT_LABEL");
        vm.startBroadcast();
        IERC20Mintable(Sepolia.MOCK_USDC).mint(msg.sender, 100e6);
        IERC20Mintable(Sepolia.MOCK_USDC).approve(Sepolia.ETH_REGISTRAR, 100e6);
        IETHRegistrar(Sepolia.ETH_REGISTRAR).register(
            label, msg.sender, _secret(label, msg.sender), address(0), address(0), DURATION,
            Sepolia.MOCK_USDC, bytes32(0)
        );
        vm.stopBroadcast();
    }

    function _commitment(string memory label, address owner) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(label, owner, _secret(label, owner), address(0), address(0), DURATION, bytes32(0))
        );
    }

    /// @dev The commitment only prevents front-running the registration, so a derived value is enough.
    function _secret(string memory label, address owner) internal pure returns (bytes32) {
        return keccak256(abi.encode("bounds", label, owner));
    }
}
