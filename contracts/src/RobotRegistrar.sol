// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {
    Grant,
    IPermissionedResolver,
    IUserRegistry,
    IVerifiableFactory,
    ResolverRoles
} from "./interfaces/IENSv2.sol";

/// @title RobotRegistrar (the "guardian")
/// @notice Issues robot licenses as ENSv2 subnames. The lease is the name's expiry and the
///         permissions are EAC roles on the name, so both lapse on their own at expiry.
/// @dev Names stay managed: this contract keeps root roles on the registry so the operator can
///      always revoke. Everything is keyed by labelhash because ENSv2 token IDs change whenever
///      roles change.
contract RobotRegistrar is Ownable2Step {
    using Strings for uint256;

    ////////////////////////////////////////////////////////////////////////
    // Constants
    ////////////////////////////////////////////////////////////////////////

    /// @notice App-level permission bits, as used by `grantLicense` and `isLicensed`.
    uint256 public constant PERMISSION_MOVE = 1;
    uint256 public constant PERMISSION_MANIPULATE = 2;
    uint256 public constant PERMISSION_ENTER_SHARED_AREA = 4;
    uint256 internal constant ALL_PERMISSIONS = 7;

    /// @notice EAC roles for those permissions. These nybbles are unused by ENSv2 registries.
    uint256 public constant ROLE_MOVE = 1 << 40;
    uint256 public constant ROLE_MANIPULATE = 1 << 44;
    uint256 public constant ROLE_ENTER_SHARED_AREA = 1 << 48;
    uint256 public constant ALL_ROBOT_ROLES = ROLE_MOVE | ROLE_MANIPULATE | ROLE_ENTER_SHARED_AREA;

    /// @dev The one text record a robot may write itself, on its own resolver only (ENSIP-26).
    string internal constant ROBOT_WRITABLE_KEY = "agent-endpoint[mcp]";

    /// @dev SLIP-44 coin type for Ethereum.
    uint256 internal constant COIN_TYPE_ETH = 60;

    ////////////////////////////////////////////////////////////////////////
    // Types
    ////////////////////////////////////////////////////////////////////////

    struct License {
        string label;
        address robot;
        bytes32 zoneId;
        bool revoked;
    }

    ////////////////////////////////////////////////////////////////////////
    // Immutables and storage
    ////////////////////////////////////////////////////////////////////////

    IUserRegistry public immutable REGISTRY;
    IVerifiableFactory public immutable FACTORY;
    address public immutable RESOLVER_IMPLEMENTATION;

    /// @notice DNS-encoded parent name, such as `\x05acme\x03eth\x00`.
    bytes public dnsParent;

    /// @notice Account allowed to revoke besides the owner: the CRE consumer.
    address public revoker;

    mapping(bytes32 labelhash => License license) internal _licenses;

    /// @notice Per-robot PermissionedResolver. ENSv2 scopes resolver roles per instance, so one
    ///         instance per robot is what keeps one robot out of another's records.
    mapping(bytes32 labelhash => address resolver) public resolverOf;

    ////////////////////////////////////////////////////////////////////////
    // Events and errors
    ////////////////////////////////////////////////////////////////////////

    event LicenseGranted(
        bytes32 indexed labelhash,
        address indexed robot,
        bytes32 zoneId,
        uint64 expiry,
        uint256 rolesBitmap,
        string label
    );
    event LicenseRevoked(
        bytes32 indexed labelhash,
        bytes32 indexed reasonCode,
        bytes32 source,
        address indexed caller,
        uint64 timestamp
    );
    event RevokerUpdated(address indexed revoker);

    error InvalidRobot();
    error InvalidZone();
    error InvalidExpiry();
    error InvalidPermissions(uint256 permissions);
    error NotRevoker(address caller);
    error NotActive(bytes32 labelhash);

    ////////////////////////////////////////////////////////////////////////
    // Setup
    ////////////////////////////////////////////////////////////////////////

    constructor(
        IUserRegistry registry,
        IVerifiableFactory factory,
        address resolverImplementation,
        bytes memory dnsParent_,
        address operator
    ) Ownable(operator) {
        REGISTRY = registry;
        FACTORY = factory;
        RESOLVER_IMPLEMENTATION = resolverImplementation;
        dnsParent = dnsParent_;
    }

    function setRevoker(address revoker_) external onlyOwner {
        revoker = revoker_;
        emit RevokerUpdated(revoker_);
    }

    ////////////////////////////////////////////////////////////////////////
    // Licensing
    ////////////////////////////////////////////////////////////////////////

    /// @notice Issue a license. Re-granting an active name replaces it, since ENSv2 expiry can
    ///         only be extended and a replacement may be shorter.
    /// @param permissions Combination of the PERMISSION_* bits.
    function grantLicense(
        string calldata label,
        address robot,
        bytes32 zoneId,
        uint64 expiry,
        uint256 permissions
    ) external onlyOwner {
        if (robot == address(0)) revert InvalidRobot();
        if (zoneId == bytes32(0)) revert InvalidZone();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (permissions == 0 || permissions & ~ALL_PERMISSIONS != 0) {
            revert InvalidPermissions(permissions);
        }

        bytes32 labelhash = keccak256(bytes(label));
        if (REGISTRY.getOwner(uint256(labelhash)) != address(0)) {
            REGISTRY.unregister(uint256(labelhash));
        }

        address resolver = _syncResolver(
            label,
            labelhash,
            robot,
            _licenseRecords(_dnsName(label), labelhash, robot, zoneId, expiry, permissions)
        );

        _licenses[labelhash] = License(label, robot, zoneId, false);
        REGISTRY.register(label, robot, address(0), resolver, _toRoles(permissions), expiry);

        emit LicenseGranted(labelhash, robot, zoneId, expiry, permissions, label);
    }

    /// @notice Revoke as the operator.
    function revokeLicense(string calldata label, bytes32 reasonCode, bytes32 source)
        external
        onlyOwner
    {
        _revoke(keccak256(bytes(label)), reasonCode, source);
    }

    /// @notice Revoke as the CRE consumer, or as the operator.
    function revokeFromCRE(bytes32 labelhash, bytes32 reasonCode, bytes32 source) external {
        if (msg.sender != revoker && msg.sender != owner()) revert NotRevoker(msg.sender);
        _revoke(labelhash, reasonCode, source);
    }

    /// @notice Write an extra record on a robot's resolver, such as an ENSIP-25 or ENSIP-26 key.
    ///         Text records are public: never pass sensitive data.
    function setAgentRecord(string calldata label, string calldata key, string calldata value)
        external
        onlyOwner
    {
        bytes32 labelhash = keccak256(bytes(label));
        address resolver = resolverOf[labelhash];
        if (resolver == address(0)) revert NotActive(labelhash);
        IPermissionedResolver(resolver).setText(_dnsName(label), key, value);
    }

    ////////////////////////////////////////////////////////////////////////
    // Views
    ////////////////////////////////////////////////////////////////////////

    /// @notice True while the robot holds every given permission. Expiry and revocation both
    ///         remove the EAC roles, so this reads the registry and nothing cached here.
    function isLicensed(string calldata label, uint256 permissions) external view returns (bool) {
        return isLicensedByHash(keccak256(bytes(label)), permissions);
    }

    function isLicensedByHash(bytes32 labelhash, uint256 permissions) public view returns (bool) {
        if (permissions == 0 || permissions & ~ALL_PERMISSIONS != 0) return false;
        address robot = _licenses[labelhash].robot;
        if (robot == address(0)) return false;
        return REGISTRY.hasRoles(uint256(labelhash), _toRoles(permissions), robot);
    }

    /// @notice Current license state, with expiry and permissions read from the ENSv2 registry.
    /// @return zoneId keccak256 of the zone ID.
    /// @return expiry Lease end in Unix seconds, or 0 if never granted.
    /// @return permissions PERMISSION_* bits still held. 0 once expired or revoked.
    /// @return revoked True if the latest grant was revoked.
    /// @return robot Address holding the license.
    /// @return resolver The robot's resolver.
    function getLicense(bytes32 labelhash)
        external
        view
        returns (
            bytes32 zoneId,
            uint64 expiry,
            uint256 permissions,
            bool revoked,
            address robot,
            address resolver
        )
    {
        License storage license = _licenses[labelhash];
        robot = license.robot;
        if (robot == address(0)) return (bytes32(0), 0, 0, false, address(0), address(0));
        uint256 held = REGISTRY.roles(uint256(labelhash), robot);
        return (
            license.zoneId,
            REGISTRY.getExpiry(uint256(labelhash)),
            _toPermissions(held),
            license.revoked,
            robot,
            resolverOf[labelhash]
        );
    }

    ////////////////////////////////////////////////////////////////////////
    // Internal
    ////////////////////////////////////////////////////////////////////////

    function _revoke(bytes32 labelhash, bytes32 reasonCode, bytes32 source) internal {
        License storage license = _licenses[labelhash];
        address robot = license.robot;
        if (
            robot == address(0) || license.revoked
                || REGISTRY.getOwner(uint256(labelhash)) == address(0)
        ) {
            revert NotActive(labelhash);
        }
        license.revoked = true;

        // Revoking roles regenerates the ERC1155 token, which calls back into a contract owner.
        // A robot contract could reject that to block its own revocation, so fall back to burning
        // the name, which makes no callback.
        try REGISTRY.revokeRoles(uint256(labelhash), ALL_ROBOT_ROLES, robot) {}
        catch {
            REGISTRY.unregister(uint256(labelhash));
        }

        address resolver = resolverOf[labelhash];
        _revokeRobotWriter(resolver, robot);
        IPermissionedResolver(resolver).setText(_dnsName(license.label), "bounds.status", "revoked");

        emit LicenseRevoked(labelhash, reasonCode, source, msg.sender, uint64(block.timestamp));
    }

    /// @dev Creates or updates the robot's resolver and gives the robot its one writable record.
    function _syncResolver(
        string memory label,
        bytes32 labelhash,
        address robot,
        bytes[] memory records
    ) internal returns (address resolver) {
        address previousRobot = _licenses[labelhash].robot;
        resolver = resolverOf[labelhash];
        if (resolver == address(0)) {
            resolver = _deployResolver(labelhash, records);
        } else {
            if (previousRobot != robot) _revokeRobotWriter(resolver, previousRobot);
            IPermissionedResolver(resolver).multicall(records);
        }
        IPermissionedResolver(resolver).grantSetterRoles(
            abi.encodeCall(IPermissionedResolver.setText, (_dnsName(label), ROBOT_WRITABLE_KEY, "")),
            robot
        );
    }

    function _deployResolver(bytes32 labelhash, bytes[] memory records)
        internal
        returns (address resolver)
    {
        Grant[] memory grants = new Grant[](1);
        grants[0] = Grant(
            address(this),
            ResolverRoles.ROLE_SET_TEXT | (ResolverRoles.ROLE_SET_TEXT << 128)
                | ResolverRoles.ROLE_SET_ADDRESS
        );
        // No account gets ROLE_UPGRADE, so these instances cannot be upgraded.
        resolver = FACTORY.deployProxy(
            RESOLVER_IMPLEMENTATION,
            uint256(labelhash),
            abi.encodeCall(IPermissionedResolver.initialize, (grants, records))
        );
        resolverOf[labelhash] = resolver;
    }

    function _revokeRobotWriter(address resolver, address robot) internal {
        IPermissionedResolver(resolver).revokeRoles(
            uint256(keccak256(bytes(ROBOT_WRITABLE_KEY))), ResolverRoles.ROLE_SET_TEXT, robot
        );
    }

    /// @dev Only hashes, state and expiry: text records are public.
    function _licenseRecords(
        bytes memory name,
        bytes32 labelhash,
        address robot,
        bytes32 zoneId,
        uint64 expiry,
        uint256 permissions
    ) internal view returns (bytes[] memory calls) {
        bytes32 statusHash = keccak256(abi.encode(labelhash, robot, zoneId, expiry, permissions));
        calls = new bytes[](6);
        calls[0] = abi.encodeCall(
            IPermissionedResolver.setAddress, (name, COIN_TYPE_ETH, abi.encodePacked(robot))
        );
        calls[1] = _setText(name, "bounds.status", "active");
        calls[2] = _setText(name, "bounds.statusHash", uint256(statusHash).toHexString(32));
        calls[3] = _setText(name, "bounds.zoneHash", uint256(zoneId).toHexString(32));
        calls[4] = _setText(name, "bounds.expiry", uint256(expiry).toString());
        calls[5] = _setText(
            name,
            "agent-context",
            string.concat(
                "Robot licensed by Bounds. Check isLicensed on RobotRegistrar ",
                Strings.toHexString(address(this)),
                " on Sepolia before acting."
            )
        );
    }

    function _setText(bytes memory name, string memory key, string memory value)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(IPermissionedResolver.setText, (name, key, value));
    }

    function _dnsName(string memory label) internal view returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(label).length), label, dnsParent);
    }

    function _toRoles(uint256 permissions) internal pure returns (uint256 roleBitmap) {
        if (permissions & PERMISSION_MOVE != 0) roleBitmap |= ROLE_MOVE;
        if (permissions & PERMISSION_MANIPULATE != 0) roleBitmap |= ROLE_MANIPULATE;
        if (permissions & PERMISSION_ENTER_SHARED_AREA != 0) roleBitmap |= ROLE_ENTER_SHARED_AREA;
    }

    function _toPermissions(uint256 roleBitmap) internal pure returns (uint256 permissions) {
        if (roleBitmap & ROLE_MOVE != 0) permissions |= PERMISSION_MOVE;
        if (roleBitmap & ROLE_MANIPULATE != 0) permissions |= PERMISSION_MANIPULATE;
        if (roleBitmap & ROLE_ENTER_SHARED_AREA != 0) permissions |= PERMISSION_ENTER_SHARED_AREA;
    }
}
