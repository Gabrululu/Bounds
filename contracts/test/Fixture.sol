// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Test} from "forge-std/Test.sol";

import {BoundsCREConsumer, ICRERevoker} from "../src/BoundsCREConsumer.sol";
import {
    Grant,
    IUserRegistry,
    IVerifiableFactory,
    RegistryRoles
} from "../src/interfaces/IENSv2.sol";
import {RobotRegistrar} from "../src/RobotRegistrar.sol";

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
}

interface IETHRegistry {
    function setSubregistry(uint256 anyId, address registry) external;
    function getOwner(uint256 anyId) external view returns (address);
}

/// @dev Runs on a fork of Sepolia against the deployed ENSv2 contracts, using the real registrar
///      flow (commit, wait, pay, register). Set FORK_BLOCK with an archive RPC to pin the fork.
abstract contract Fixture is Test {
    // docs.ens.domains/learn/deployments, Sepolia ENSv2.
    IETHRegistrar internal constant ETH_REGISTRAR =
        IETHRegistrar(0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3);
    IETHRegistry internal constant ETH_REGISTRY =
        IETHRegistry(0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4);
    IVerifiableFactory internal constant FACTORY =
        IVerifiableFactory(0xDa70306C98E97eCe36F997a21368e53298572991);
    address internal constant USER_REGISTRY_IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    address internal constant RESOLVER_IMPL = 0x115eb53F0c60696633855F90b138178Fb40b2b2C;
    address internal constant UNIVERSAL_RESOLVER = 0x24E1D8e068620B647CA097f961A61055f4f42D72;
    address internal constant MOCK_USDC = 0x240b0316Df57887DBBE58b586508b19e633a14aa;

    address internal operator = makeAddr("operator");
    address internal forwarder = makeAddr("forwarder");
    address internal robot = makeAddr("robot");
    address internal stranger = makeAddr("stranger");

    string internal parentLabel;
    bytes internal dnsParent;
    IUserRegistry internal registry;
    RobotRegistrar internal registrar;
    BoundsCREConsumer internal consumer;

    bytes32 internal constant ZONE = keccak256("cell-a");
    bytes32 internal constant REASON = "HIGH_WIND";
    bytes32 internal constant SOURCE = "open-meteo";

    function setUp() public virtual {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com"));
        uint256 forkBlock = vm.envOr("FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);

        parentLabel = string.concat("bounds-test-", vm.toString(block.timestamp));
        dnsParent = abi.encodePacked(uint8(bytes(parentLabel).length), parentLabel, uint8(3), "eth", uint8(0));
        _registerParent();
        _deploy();
    }

    function _registerParent() internal {
        uint64 duration = 365 days;
        bytes32 secret = keccak256("secret");
        vm.startPrank(operator);
        ETH_REGISTRAR.commit(
            ETH_REGISTRAR.makeCommitment(parentLabel, operator, secret, address(0), address(0), duration, bytes32(0))
        );
        skip(61);
        IERC20Mintable(MOCK_USDC).mint(operator, 1_000e6);
        IERC20Mintable(MOCK_USDC).approve(address(ETH_REGISTRAR), type(uint256).max);
        ETH_REGISTRAR.register(
            parentLabel, operator, secret, address(0), address(0), duration, MOCK_USDC, bytes32(0)
        );
        vm.stopPrank();
    }

    function _deploy() internal {
        uint256 robotRoleAdmins = uint256((1 << 40) | (1 << 44) | (1 << 48)) << 128;
        uint256 operatorRoles = RegistryRoles.ROLE_REGISTRAR
            | (RegistryRoles.ROLE_REGISTRAR << 128)
            | RegistryRoles.ROLE_UNREGISTER
            | (RegistryRoles.ROLE_UNREGISTER << 128)
            | RegistryRoles.ROLE_SET_PARENT
            | robotRoleAdmins;
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(operator, operatorRoles);

        vm.startPrank(operator);
        registry = IUserRegistry(
            FACTORY.deployProxy(
                USER_REGISTRY_IMPL,
                uint256(keccak256(bytes(parentLabel))),
                abi.encodeCall(IUserRegistry.initialize, (grants))
            )
        );
        registrar = new RobotRegistrar(registry, FACTORY, RESOLVER_IMPL, dnsParent, operator);
        consumer = new BoundsCREConsumer(ICRERevoker(address(registrar)), forwarder, operator);
        registrar.setRevoker(address(consumer));
        registry.grantRootRoles(
            RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER | robotRoleAdmins,
            address(registrar)
        );
        ETH_REGISTRY.setSubregistry(uint256(keccak256(bytes(parentLabel))), address(registry));
        registry.setParent(address(ETH_REGISTRY), parentLabel);
        vm.stopPrank();
    }

    function _grant(string memory label, uint256 permissions) internal returns (uint64 expiry) {
        expiry = uint64(block.timestamp + 1 days);
        vm.prank(operator);
        registrar.grantLicense(label, robot, ZONE, expiry, permissions);
    }

    function _dnsName(string memory label) internal view returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(label).length), label, dnsParent);
    }
}
