// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {BoundsCREConsumer, IReceiver} from "../src/BoundsCREConsumer.sol";
import {RobotRegistrar} from "../src/RobotRegistrar.sol";
import {Fixture} from "./Fixture.sol";

contract BoundsCREConsumerForkTest is Fixture {
    string internal constant LABEL = "robot-07";
    bytes32 internal labelhash = keccak256(bytes(LABEL));

    bytes32 internal constant WORKFLOW_ID = keccak256("workflow");
    address internal constant WORKFLOW_OWNER = address(0xC0FFEE);

    function setUp() public override {
        super.setUp();
        _grant(LABEL, 1);
    }

    function _report() internal view returns (bytes memory) {
        return abi.encode(labelhash, REASON, SOURCE);
    }

    function _metadata(bytes32 id, address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(id, bytes10("bounds"), owner, bytes2(0x0001));
    }

    function test_onReport_fromForwarderRevokesLicense() public {
        vm.expectEmit(true, true, true, true, address(registrar));
        emit RobotRegistrar.LicenseRevoked(labelhash, REASON, SOURCE, address(consumer), uint64(block.timestamp));
        vm.prank(forwarder);
        consumer.onReport("", _report());

        assertFalse(registrar.isLicensed(LABEL, 1));
    }

    function test_onReport_rejectsAnyoneButForwarder() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BoundsCREConsumer.InvalidSender.selector, stranger));
        consumer.onReport("", _report());

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(BoundsCREConsumer.InvalidSender.selector, operator));
        consumer.onReport("", _report());

        assertTrue(registrar.isLicensed(LABEL, 1));
    }

    function test_onReport_checksWorkflowIdAndOwnerWhenSet() public {
        vm.prank(operator);
        consumer.setExpectedWorkflow(WORKFLOW_ID, WORKFLOW_OWNER);

        vm.startPrank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(BoundsCREConsumer.InvalidMetadata.selector, 0));
        consumer.onReport("", _report());

        bytes32 wrongId = keccak256("other");
        vm.expectRevert(abi.encodeWithSelector(BoundsCREConsumer.InvalidWorkflowId.selector, wrongId));
        consumer.onReport(_metadata(wrongId, WORKFLOW_OWNER), _report());

        vm.expectRevert(abi.encodeWithSelector(BoundsCREConsumer.InvalidWorkflowOwner.selector, stranger));
        consumer.onReport(_metadata(WORKFLOW_ID, stranger), _report());
        assertTrue(registrar.isLicensed(LABEL, 1));

        consumer.onReport(_metadata(WORKFLOW_ID, WORKFLOW_OWNER), _report());
        vm.stopPrank();
        assertFalse(registrar.isLicensed(LABEL, 1));
    }

    function test_onReport_replayCannotDoubleRevoke() public {
        vm.startPrank(forwarder);
        consumer.onReport("", _report());
        vm.expectRevert(abi.encodeWithSelector(RobotRegistrar.NotActive.selector, labelhash));
        consumer.onReport("", _report());
        vm.stopPrank();
    }

    function test_settersAreOwnerOnly() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        consumer.setForwarder(stranger);
        vm.expectRevert();
        consumer.setExpectedWorkflow(bytes32(0), address(0));
        vm.expectRevert();
        registrar.setRevoker(stranger);
        vm.stopPrank();
    }

    function test_supportsReceiverInterface() public view {
        assertTrue(consumer.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(consumer.supportsInterface(type(IERC165).interfaceId));
        assertFalse(consumer.supportsInterface(0xffffffff));
    }
}
