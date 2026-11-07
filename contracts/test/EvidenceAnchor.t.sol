// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Test} from "forge-std/Test.sol";

import {EvidenceAnchor} from "../src/EvidenceAnchor.sol";

contract EvidenceAnchorTest is Test {
    address internal operator = makeAddr("operator");
    EvidenceAnchor internal anchor;

    bytes32 internal constant LABELHASH = keccak256("robot-07");
    bytes32 internal constant ROOT = keccak256("root");
    bytes32 internal constant DECISIONS = keccak256("decisions");

    function setUp() public {
        anchor = new EvidenceAnchor(operator);
    }

    function test_anchor_emitsAndRecordsTime() public {
        vm.warp(1_000);
        vm.expectEmit(true, true, true, true);
        emit EvidenceAnchor.EpisodeAnchored(LABELHASH, ROOT, DECISIONS, 900);
        vm.prank(operator);
        anchor.anchorEpisode(LABELHASH, ROOT, DECISIONS, 900);
        assertEq(anchor.anchoredAt(ROOT), 1_000);
    }

    function test_anchor_cannotRewriteAnchoredRoot() public {
        vm.warp(1_000);
        vm.startPrank(operator);
        anchor.anchorEpisode(LABELHASH, ROOT, DECISIONS, 900);
        vm.warp(2_000);
        vm.expectRevert(abi.encodeWithSelector(EvidenceAnchor.AlreadyAnchored.selector, ROOT));
        anchor.anchorEpisode(LABELHASH, ROOT, bytes32(0), 1_900);
        vm.stopPrank();
        assertEq(anchor.anchoredAt(ROOT), 1_000);
    }

    function test_anchor_rejectsZeroRoot() public {
        vm.prank(operator);
        vm.expectRevert(EvidenceAnchor.InvalidRootHash.selector);
        anchor.anchorEpisode(LABELHASH, bytes32(0), DECISIONS, 900);
    }

    function test_anchor_rejectsUnauthorizedCaller() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        anchor.anchorEpisode(LABELHASH, ROOT, DECISIONS, 900);
    }

    function test_ownership_transferNeedsAcceptance() public {
        address next = makeAddr("next");
        vm.prank(operator);
        anchor.transferOwnership(next);
        assertEq(anchor.owner(), operator);
        vm.prank(next);
        anchor.acceptOwnership();
        assertEq(anchor.owner(), next);
    }
}
