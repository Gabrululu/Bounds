// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/// @dev Sepolia addresses. ENSv2: docs.ens.domains/learn/deployments.
///      Forwarders: docs.chain.link/cre (Forwarder Directory).
library Sepolia {
    address internal constant ETH_REGISTRAR = 0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3;
    address internal constant ETH_REGISTRY = 0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4;
    address internal constant VERIFIABLE_FACTORY = 0xDa70306C98E97eCe36F997a21368e53298572991;
    address internal constant USER_REGISTRY_IMPL = 0x9BD8a88719068D09ecee662f36C0E3856708366a;
    address internal constant RESOLVER_IMPL = 0x115eb53F0c60696633855F90b138178Fb40b2b2C;
    address internal constant UNIVERSAL_RESOLVER = 0x24E1D8e068620B647CA097f961A61055f4f42D72;
    address internal constant MOCK_USDC = 0x240b0316Df57887DBBE58b586508b19e633a14aa;
    address internal constant CRE_MOCK_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    address internal constant CRE_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;
}
