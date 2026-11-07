import { parseAbi } from "viem";

/**
 * PLACEHOLDER: replace with the real guardian ABI.
 *
 * Only `grantLicense(label, zoneId, expiry, rolesBitmap)`, `revokeLicense(label)` and
 * `LicenseRevoked(label, reason, source)` come from the spec, and their parameter types are
 * assumed here. `getLicense` and `LicenseGranted` are assumptions too: the app needs some read
 * for role state and some event for grant history.
 *
 * If the real ABI differs, src/services/guardian.ts is the only file that has to change.
 */
export const guardianAbi = parseAbi([
  "function grantLicense(string label, bytes32 zoneId, uint64 expiry, uint256 rolesBitmap)",
  "function revokeLicense(string label)",
  "function getLicense(bytes32 labelhash) view returns (bytes32 zoneId, uint64 expiry, uint256 rolesBitmap, bool revoked)",
  "event LicenseGranted(bytes32 indexed label, bytes32 zoneId, uint64 expiry, uint256 rolesBitmap)",
  "event LicenseRevoked(bytes32 indexed label, string reason, address indexed source)",
]);
