// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title EvidenceAnchor
/// @notice Links a robot's episode to its 0G Storage root hash with an onchain timestamp.
contract EvidenceAnchor is Ownable2Step {
    /// @notice When each root hash was anchored. 0 if never.
    mapping(bytes32 zgRootHash => uint64 anchoredAt) public anchoredAt;

    event EpisodeAnchored(
        bytes32 indexed labelhash,
        bytes32 indexed zgRootHash,
        bytes32 decisionsHash,
        uint64 timestamp
    );

    error InvalidRootHash();
    error AlreadyAnchored(bytes32 zgRootHash);

    constructor(address operator) Ownable(operator) {}

    /// @param timestamp Episode start in Unix seconds.
    function anchorEpisode(
        bytes32 labelhash,
        bytes32 zgRootHash,
        bytes32 decisionsHash,
        uint64 timestamp
    ) external onlyOwner {
        if (zgRootHash == bytes32(0)) revert InvalidRootHash();
        if (anchoredAt[zgRootHash] != 0) revert AlreadyAnchored(zgRootHash);
        anchoredAt[zgRootHash] = uint64(block.timestamp);
        emit EpisodeAnchored(labelhash, zgRootHash, decisionsHash, timestamp);
    }
}
