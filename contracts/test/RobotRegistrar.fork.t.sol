// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Vm} from "forge-std/Vm.sol";

import {IPermissionedResolver} from "../src/interfaces/IENSv2.sol";
import {RobotRegistrar} from "../src/RobotRegistrar.sol";
import {Fixture} from "./Fixture.sol";

interface IUniversalResolver {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, address resolver);
}

interface ITextProfile {
    function text(bytes32 node, string calldata key) external view returns (string memory);
    function addr(bytes32 node) external view returns (address);
}

/// @dev Accepts the first mint, then rejects every later token, as a robot blocking revocation would.
contract HostileRobot {
    bool internal minted;

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        require(!minted, "no revocation for me");
        minted = true;
        return this.onERC1155Received.selector;
    }
}

contract RobotRegistrarForkTest is Fixture {
    uint256 internal constant MOVE = 1;
    uint256 internal constant MANIPULATE = 2;
    uint256 internal constant SHARED = 4;
    string internal constant LABEL = "robot-07";
    bytes32 internal labelhash = keccak256(bytes(LABEL));

    function _node() internal view returns (bytes32) {
        bytes32 eth = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        bytes32 parent = keccak256(abi.encodePacked(eth, keccak256(bytes(parentLabel))));
        return keccak256(abi.encodePacked(parent, labelhash));
    }

    /// @dev Reads through the Universal Resolver from the root, the way clients do.
    function _text(string memory key) internal view returns (string memory) {
        (bytes memory result,) = IUniversalResolver(UNIVERSAL_RESOLVER).resolve(
            _dnsName(LABEL), abi.encodeCall(ITextProfile.text, (_node(), key))
        );
        return abi.decode(result, (string));
    }

    ////////////////////////////////////////////////////////////////////////
    // Grant
    ////////////////////////////////////////////////////////////////////////

    function test_grant_makesRobotResolvableFromEnsRoot() public {
        uint64 expiry = _grant(LABEL, MOVE | SHARED);

        (bytes memory addrResult,) = IUniversalResolver(UNIVERSAL_RESOLVER).resolve(
            _dnsName(LABEL), abi.encodeCall(ITextProfile.addr, (_node()))
        );
        assertEq(abi.decode(addrResult, (address)), robot);
        assertEq(_text("bounds.status"), "active");
        assertEq(_text("bounds.zoneHash"), vm.toString(ZONE));
        assertEq(_text("bounds.expiry"), vm.toString(uint256(expiry)));
    }

    function test_grant_givesExactlyTheRequestedPermissions() public {
        _grant(LABEL, MOVE | SHARED);

        assertTrue(registrar.isLicensed(LABEL, MOVE));
        assertTrue(registrar.isLicensed(LABEL, SHARED));
        assertTrue(registrar.isLicensed(LABEL, MOVE | SHARED));
        assertFalse(registrar.isLicensed(LABEL, MANIPULATE));
        assertFalse(registrar.isLicensed(LABEL, MOVE | MANIPULATE));
        (,, uint256 permissions,,,) = registrar.getLicense(labelhash);
        assertEq(permissions, MOVE | SHARED);
    }

    function test_grant_doesNotEmancipateOrEmpowerRobot() public {
        _grant(LABEL, MOVE);
        uint256 roleMove = registrar.ROLE_MOVE();

        vm.startPrank(robot);
        vm.expectRevert();
        registry.unregister(uint256(labelhash));
        vm.expectRevert();
        registry.revokeRoles(uint256(labelhash), roleMove, robot);
        vm.expectRevert();
        registry.grantRootRoles(roleMove << 128, robot);
        vm.stopPrank();
    }

    function test_grant_rejectsInvalidInput() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.startPrank(operator);
        vm.expectRevert(RobotRegistrar.InvalidRobot.selector);
        registrar.grantLicense(LABEL, address(0), ZONE, expiry, MOVE);
        vm.expectRevert(RobotRegistrar.InvalidZone.selector);
        registrar.grantLicense(LABEL, robot, bytes32(0), expiry, MOVE);
        vm.expectRevert(RobotRegistrar.InvalidExpiry.selector);
        registrar.grantLicense(LABEL, robot, ZONE, uint64(block.timestamp), MOVE);
        vm.expectRevert(abi.encodeWithSelector(RobotRegistrar.InvalidPermissions.selector, 0));
        registrar.grantLicense(LABEL, robot, ZONE, expiry, 0);
        vm.expectRevert(abi.encodeWithSelector(RobotRegistrar.InvalidPermissions.selector, 8));
        registrar.grantLicense(LABEL, robot, ZONE, expiry, 8);
        vm.stopPrank();
    }

    function test_grant_rejectsUnauthorizedCaller() public {
        vm.prank(stranger);
        vm.expectRevert();
        registrar.grantLicense(LABEL, robot, ZONE, uint64(block.timestamp + 1 days), MOVE);
    }

    function testFuzz_grant_permissionsRoundTrip(uint8 raw) public {
        uint256 permissions = bound(raw, 1, 7);
        _grant(LABEL, permissions);
        (,, uint256 held,,,) = registrar.getLicense(labelhash);
        assertEq(held, permissions);
        assertTrue(registrar.isLicensed(LABEL, permissions));
    }

    function test_regrant_canShortenLeaseAndChangeRobot() public {
        _grant(LABEL, MOVE);
        address other = makeAddr("other-robot");
        uint64 shorter = uint64(block.timestamp + 1 hours);

        vm.prank(operator);
        registrar.grantLicense(LABEL, other, ZONE, shorter, MANIPULATE);

        (, uint64 expiry, uint256 permissions,, address holder,) = registrar.getLicense(labelhash);
        assertEq(expiry, shorter);
        assertEq(permissions, MANIPULATE);
        assertEq(holder, other);
        assertEq(registry.getOwner(uint256(labelhash)), other);
        assertFalse(registry.hasRoles(uint256(labelhash), registrar.ROLE_MOVE(), robot));
    }

    ////////////////////////////////////////////////////////////////////////
    // Revoke
    ////////////////////////////////////////////////////////////////////////

    function test_revoke_byOperatorRemovesPermissionsAndUpdatesEns() public {
        _grant(LABEL, MOVE | MANIPULATE);

        vm.expectEmit(true, true, true, true, address(registrar));
        emit RobotRegistrar.LicenseRevoked(labelhash, REASON, SOURCE, operator, uint64(block.timestamp));
        vm.prank(operator);
        registrar.revokeLicense(LABEL, REASON, SOURCE);

        assertFalse(registrar.isLicensed(LABEL, MOVE));
        assertFalse(registrar.isLicensed(LABEL, MANIPULATE));
        (,, uint256 permissions, bool revoked,,) = registrar.getLicense(labelhash);
        assertEq(permissions, 0);
        assertTrue(revoked);
        assertEq(_text("bounds.status"), "revoked");
    }

    function test_revoke_rejectsUnauthorizedCallers() public {
        _grant(LABEL, MOVE);

        vm.startPrank(stranger);
        vm.expectRevert();
        registrar.revokeLicense(LABEL, REASON, SOURCE);
        vm.expectRevert(abi.encodeWithSelector(RobotRegistrar.NotRevoker.selector, stranger));
        registrar.revokeFromCRE(labelhash, REASON, SOURCE);
        vm.stopPrank();

        vm.prank(robot);
        vm.expectRevert(abi.encodeWithSelector(RobotRegistrar.NotRevoker.selector, robot));
        registrar.revokeFromCRE(labelhash, REASON, SOURCE);

        assertTrue(registrar.isLicensed(LABEL, MOVE));
    }

    function test_revoke_rejectsUnknownAndAlreadyRevoked() public {
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(RobotRegistrar.NotActive.selector, labelhash));
        registrar.revokeLicense(LABEL, REASON, SOURCE);
        vm.stopPrank();

        _grant(LABEL, MOVE);
        vm.startPrank(operator);
        registrar.revokeLicense(LABEL, REASON, SOURCE);
        vm.expectRevert(abi.encodeWithSelector(RobotRegistrar.NotActive.selector, labelhash));
        registrar.revokeLicense(LABEL, REASON, SOURCE);
        vm.stopPrank();
    }

    function test_revoke_cannotBeBlockedByHostileRobotContract() public {
        HostileRobot hostile = new HostileRobot();
        vm.prank(operator);
        registrar.grantLicense(LABEL, address(hostile), ZONE, uint64(block.timestamp + 1 days), MOVE);
        assertTrue(registrar.isLicensed(LABEL, MOVE));

        vm.prank(operator);
        registrar.revokeLicense(LABEL, REASON, SOURCE);

        assertFalse(registrar.isLicensed(LABEL, MOVE));
        (,, uint256 permissions, bool revoked,,) = registrar.getLicense(labelhash);
        assertEq(permissions, 0);
        assertTrue(revoked);
    }

    function test_regrant_afterRevokeRestoresLicense() public {
        _grant(LABEL, MOVE);
        vm.prank(operator);
        registrar.revokeLicense(LABEL, REASON, SOURCE);

        _grant(LABEL, MOVE);

        assertTrue(registrar.isLicensed(LABEL, MOVE));
        (,,, bool revoked,,) = registrar.getLicense(labelhash);
        assertFalse(revoked);
        assertEq(_text("bounds.status"), "active");
    }

    ////////////////////////////////////////////////////////////////////////
    // Expiry
    ////////////////////////////////////////////////////////////////////////

    function test_expiry_endsLicenseWithoutAnyTransaction() public {
        uint64 expiry = _grant(LABEL, MOVE);
        assertTrue(registrar.isLicensed(LABEL, MOVE));

        vm.warp(expiry - 1);
        assertTrue(registrar.isLicensed(LABEL, MOVE));

        vm.warp(expiry);
        assertFalse(registrar.isLicensed(LABEL, MOVE));
        assertEq(registry.getOwner(uint256(labelhash)), address(0));
        (,, uint256 permissions,,,) = registrar.getLicense(labelhash);
        assertEq(permissions, 0);
    }

    function test_expiry_cannotRevokeExpiredThenRegrantWorks() public {
        uint64 expiry = _grant(LABEL, MOVE);
        vm.warp(expiry);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RobotRegistrar.NotActive.selector, labelhash));
        registrar.revokeLicense(LABEL, REASON, SOURCE);

        _grant(LABEL, MANIPULATE);
        assertTrue(registrar.isLicensed(LABEL, MANIPULATE));
        assertFalse(registrar.isLicensed(LABEL, MOVE));
    }

    ////////////////////////////////////////////////////////////////////////
    // Token regeneration
    ////////////////////////////////////////////////////////////////////////

    function test_tokenRegeneration_labelhashKeepsWorking() public {
        _grant(LABEL, MOVE);
        uint256 tokenBefore = registry.getTokenId(uint256(labelhash));

        vm.recordLogs();
        vm.prank(operator);
        registrar.revokeLicense(LABEL, REASON, SOURCE);

        uint256 tokenAfter = registry.getTokenId(uint256(labelhash));
        assertNotEq(tokenBefore, tokenAfter);
        bytes32 regenerated = keccak256("TokenRegenerated(uint256,uint256)");
        bool seen;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(registry) && logs[i].topics[0] == regenerated) seen = true;
        }
        assertTrue(seen, "TokenRegenerated not emitted");

        // The old ID is stale, and labelhash-keyed state still answers.
        assertEq(registry.getOwner(uint256(labelhash)), robot);
        (,,, bool revoked,,) = registrar.getLicense(labelhash);
        assertTrue(revoked);
    }

    ////////////////////////////////////////////////////////////////////////
    // Per-robot resolver scoping
    ////////////////////////////////////////////////////////////////////////

    function test_resolver_robotWritesOnlyItsOwnEndpoint() public {
        _grant(LABEL, MOVE);
        string memory otherLabel = "robot-08";
        vm.prank(operator);
        registrar.grantLicense(otherLabel, makeAddr("robot-08"), ZONE, uint64(block.timestamp + 1 days), MOVE);

        IPermissionedResolver own = IPermissionedResolver(registrar.resolverOf(labelhash));
        IPermissionedResolver other =
            IPermissionedResolver(registrar.resolverOf(keccak256(bytes(otherLabel))));
        assertNotEq(address(own), address(other));

        vm.startPrank(robot);
        own.setText(_dnsName(LABEL), "agent-endpoint[mcp]", "https://robot.example/mcp");
        vm.expectRevert();
        own.setText(_dnsName(LABEL), "bounds.status", "active");
        vm.expectRevert();
        other.setText(_dnsName(otherLabel), "agent-endpoint[mcp]", "https://attacker.example");
        vm.stopPrank();

        assertEq(_text("agent-endpoint[mcp]"), "https://robot.example/mcp");
    }

    function test_resolver_revocationRemovesRobotWriteAccess() public {
        _grant(LABEL, MOVE);
        IPermissionedResolver own = IPermissionedResolver(registrar.resolverOf(labelhash));
        vm.prank(operator);
        registrar.revokeLicense(LABEL, REASON, SOURCE);

        vm.prank(robot);
        vm.expectRevert();
        own.setText(_dnsName(LABEL), "agent-endpoint[mcp]", "https://robot.example/mcp");
    }

    function test_setAgentRecord_writesEnsip25Key() public {
        _grant(LABEL, MOVE);
        string memory key = "agent-registration[0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432][167]";

        vm.prank(stranger);
        vm.expectRevert();
        registrar.setAgentRecord(LABEL, key, "1");

        vm.prank(operator);
        registrar.setAgentRecord(LABEL, key, "1");
        assertEq(_text(key), "1");
    }
}
