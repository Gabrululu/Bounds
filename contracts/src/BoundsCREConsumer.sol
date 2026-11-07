// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @dev Chainlink's receiver interface, from docs.chain.link/cre (Building Consumer Contracts).
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface ICRERevoker {
    function revokeFromCRE(bytes32 labelhash, bytes32 reasonCode, bytes32 source) external;
}

/// @title BoundsCREConsumer
/// @notice Receives CRE workflow reports through the Chainlink Forwarder and revokes licenses.
/// @dev While the forwarder is Chainlink's mock, used for `cre workflow simulate --broadcast`,
///      reports are not signed and metadata is not provided, so workflow checks must stay unset.
///      Anyone can then send a report through the mock. Production use needs the
///      KeystoneForwarder and an expected workflow ID.
contract BoundsCREConsumer is IReceiver, Ownable2Step {
    ICRERevoker public immutable REGISTRAR;

    address public forwarder;
    bytes32 public expectedWorkflowId;
    address public expectedWorkflowOwner;

    event ForwarderUpdated(address indexed forwarder);
    event ExpectedWorkflowUpdated(bytes32 indexed workflowId, address indexed workflowOwner);
    event ReportProcessed(bytes32 indexed labelhash, bytes32 indexed reasonCode, bytes32 source);

    error InvalidForwarder();
    error InvalidSender(address sender);
    error InvalidMetadata(uint256 length);
    error InvalidWorkflowId(bytes32 workflowId);
    error InvalidWorkflowOwner(address workflowOwner);

    constructor(ICRERevoker registrar, address forwarder_, address operator) Ownable(operator) {
        if (forwarder_ == address(0)) revert InvalidForwarder();
        REGISTRAR = registrar;
        forwarder = forwarder_;
    }

    function setForwarder(address forwarder_) external onlyOwner {
        if (forwarder_ == address(0)) revert InvalidForwarder();
        forwarder = forwarder_;
        emit ForwarderUpdated(forwarder_);
    }

    /// @notice Zero values disable each check.
    function setExpectedWorkflow(bytes32 workflowId, address workflowOwner) external onlyOwner {
        expectedWorkflowId = workflowId;
        expectedWorkflowOwner = workflowOwner;
        emit ExpectedWorkflowUpdated(workflowId, workflowOwner);
    }

    /// @inheritdoc IReceiver
    /// @param metadata abi.encodePacked(bytes32 workflowId, bytes10 name, address owner), followed
    ///        by a 2-byte report ID on the production forwarder.
    /// @param report abi.encode(bytes32 labelhash, bytes32 reasonCode, bytes32 source)
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender);

        if (expectedWorkflowId != bytes32(0) || expectedWorkflowOwner != address(0)) {
            if (metadata.length < 62) revert InvalidMetadata(metadata.length);
            bytes32 workflowId = bytes32(metadata[:32]);
            address workflowOwner = address(bytes20(metadata[42:62]));
            if (expectedWorkflowId != bytes32(0) && workflowId != expectedWorkflowId) {
                revert InvalidWorkflowId(workflowId);
            }
            if (expectedWorkflowOwner != address(0) && workflowOwner != expectedWorkflowOwner) {
                revert InvalidWorkflowOwner(workflowOwner);
            }
        }

        (bytes32 labelhash, bytes32 reasonCode, bytes32 source) =
            abi.decode(report, (bytes32, bytes32, bytes32));
        REGISTRAR.revokeFromCRE(labelhash, reasonCode, source);
        emit ReportProcessed(labelhash, reasonCode, source);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
