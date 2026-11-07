// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/// @dev Minimal interfaces for the ENSv2 contracts deployed on Sepolia, matching
///      ensdomains/contracts-v2 at commit 07e55a056f5b6a9c90119f501bdd05714e67dddd.
///      They are local because that repo's recursive submodules cannot be checked out on Windows.
///      Fork tests in test/ run them against the deployed bytecode.

struct Grant {
    address account;
    uint256 roleBitmap;
}

interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes memory data)
        external
        returns (address);
}

interface IUserRegistry {
    function initialize(Grant[] calldata grants) external;

    function register(
        string memory label,
        address owner,
        address registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);

    function unregister(uint256 anyId) external;

    function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);

    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);

    function revokeRootRoles(uint256 roleBitmap, address account) external returns (bool);

    function setParent(address parent, string memory label) external;

    function hasRoles(uint256 anyId, uint256 roleBitmap, address account)
        external
        view
        returns (bool);

    function roles(uint256 anyId, address account) external view returns (uint256);

    function getExpiry(uint256 anyId) external view returns (uint64);

    function getOwner(uint256 anyId) external view returns (address);

    function getTokenId(uint256 anyId) external view returns (uint256);

    function getResolver(string calldata label) external view returns (address);
}

interface IPermissionedResolver {
    function initialize(Grant[] calldata grants, bytes[] calldata calls) external;

    function multicall(bytes[] calldata calls) external returns (bytes[] memory);

    function setText(bytes calldata name, string calldata key, string calldata value) external;

    function setAddress(bytes calldata name, uint256 coinType, bytes calldata addressBytes) external;

    function grantSetterRoles(bytes calldata setter, address account) external returns (bool);

    function revokeRoles(uint256 resource, uint256 roleBitmap, address account)
        external
        returns (bool);
}

/// @dev Registry role values from RegistryRolesLib. An admin role is its role shifted left by 128.
library RegistryRoles {
    uint256 internal constant ROLE_REGISTRAR = 1 << 0;
    uint256 internal constant ROLE_SET_PARENT = 1 << 8;
    uint256 internal constant ROLE_UNREGISTER = 1 << 12;
}

/// @dev Resolver role values from PermissionedResolverLib.
library ResolverRoles {
    uint256 internal constant ROLE_SET_ADDRESS = 1 << 0;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
}
