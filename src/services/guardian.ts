// The only module that knows the guardian's ABI shape. The guardian is the RobotRegistrar contract,
// and src/abi/guardian.ts is generated from it by contracts/export-abi.mjs.
import { hexToString, keccak256, stringToBytes, stringToHex, type Address, type Hash } from "viem";
import { simulateContract, writeContract } from "wagmi/actions";
import { guardianAbi } from "@/abi/guardian";
import { sepolia, wagmiConfig } from "@/lib/wagmi";
import { SEPOLIA_BLOCK_SECONDS, publicClient, scanRange } from "./chain";
import { getSettings, guardianAddress } from "./config";
import { DAY } from "./events";
import type { Permission } from "./types";

const ROLE_BITS: Record<Permission, bigint> = {
  move: 1n,
  manipulate: 2n,
  "enter-shared-area": 4n,
};

export function encodeRoles(permissions: Permission[]): bigint {
  return permissions.reduce((bitmap, p) => bitmap | ROLE_BITS[p], 0n);
}

export function decodeRoles(bitmap: bigint): Permission[] {
  return (Object.keys(ROLE_BITS) as Permission[]).filter((p) => (bitmap & ROLE_BITS[p]) !== 0n);
}

export const zoneIdHash = (zoneId: string): Hash => keccak256(stringToBytes(zoneId));

/** Reason codes and sources are short text stored as bytes32. */
export const toBytes32Text = (text: string): Hash => stringToHex(text, { size: 32 });
export const fromBytes32Text = (value: Hash): string => hexToString(value, { size: 32 });

const DASHBOARD_REVOKE = { reason: "OPERATOR_REVOKE", source: "dashboard" };

export interface OnChainLicense {
  zoneHash: Hash;
  /** ms since epoch; 0 when never granted. */
  expiresAt: number;
  roles: Permission[];
  revoked: boolean;
}

export async function readLicense(labelhash: Hash): Promise<OnChainLicense> {
  const [zoneHash, expiry, permissions, revoked] = await publicClient.readContract({
    address: guardianAddress(),
    abi: guardianAbi,
    functionName: "getLicense",
    args: [labelhash],
  });
  return { zoneHash, expiresAt: Number(expiry) * 1000, roles: decodeRoles(permissions), revoked };
}

export async function sendGrant(
  account: Address,
  label: string,
  robot: Address,
  zoneId: string,
  expirySeconds: bigint,
  permissions: Permission[],
): Promise<Hash> {
  // Simulate first so a revert surfaces its reason instead of a failed transaction.
  const { request } = await simulateContract(wagmiConfig, {
    account,
    chainId: sepolia.id,
    address: guardianAddress(),
    abi: guardianAbi,
    functionName: "grantLicense",
    args: [label, robot, zoneIdHash(zoneId), expirySeconds, encodeRoles(permissions)],
  });
  return writeContract(wagmiConfig, request);
}

export async function sendRevoke(account: Address, label: string): Promise<Hash> {
  const { request } = await simulateContract(wagmiConfig, {
    account,
    chainId: sepolia.id,
    address: guardianAddress(),
    abi: guardianAbi,
    functionName: "revokeLicense",
    args: [label, toBytes32Text(DASHBOARD_REVOKE.reason), toBytes32Text(DASHBOARD_REVOKE.source)],
  });
  return writeContract(wagmiConfig, request);
}

export interface GrantLog {
  labelhash: Hash;
  label: string;
  zoneHash: Hash;
  expiresAt: number;
  roles: Permission[];
  tx: Hash;
  at: number;
  blockNumber: bigint;
}

export interface RevokeLog {
  id: string;
  labelhash: Hash;
  reason: string;
  /** Who decided: "open-meteo" for the CRE workflow, "dashboard" for an operator. */
  source: string;
  /** Contract or wallet that sent the revocation. */
  caller: Address;
  tx: Hash;
  at: number;
  blockNumber: bigint;
}

const REVOCATION_POLL_MS = 15_000;
const DEFAULT_LOOKBACK_BLOCKS = BigInt(Math.floor((30 * DAY) / 1000 / SEPOLIA_BLOCK_SECONDS));

/** Whether scans may miss history because no deploy block is configured. */
export const scanIsPartial = () => !getSettings().deployBlock;

function scanFloor(head: bigint): bigint {
  const deployBlock = getSettings().deployBlock;
  if (deployBlock) return BigInt(deployBlock);
  return head > DEFAULT_LOOKBACK_BLOCKS ? head - DEFAULT_LOOKBACK_BLOCKS : 0n;
}

const blockTimes = new Map<bigint, number>();

async function blockTimestamp(blockNumber: bigint): Promise<number> {
  const known = blockTimes.get(blockNumber);
  if (known !== undefined) return known;
  const block = await publicClient.getBlock({ blockNumber });
  const at = Number(block.timestamp) * 1000;
  blockTimes.set(blockNumber, at);
  return at;
}

/** Incremental log cache: each call only fetches blocks newer than the last scan. */
function incrementalScan<T>(
  fetchChunk: (address: Address, from: bigint, to: bigint) => Promise<T[]>,
) {
  let cache: { address: Address; to: bigint; logs: T[] } | null = null;
  let inflight: Promise<T[]> | null = null;
  return (): Promise<T[]> => {
    if (inflight) return inflight;
    inflight = (async () => {
      const address = guardianAddress();
      const head = await publicClient.getBlockNumber();
      if (cache?.address !== address) cache = { address, to: scanFloor(head) - 1n, logs: [] };
      if (head > cache.to) {
        const fresh = await scanRange(cache.to + 1n, head, (from, to) =>
          fetchChunk(address, from, to),
        );
        cache = { address, to: head, logs: [...cache.logs, ...fresh] };
      }
      return cache.logs;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

export const fetchGrantLogs = incrementalScan<GrantLog>(async (address, fromBlock, toBlock) => {
  const logs = await publicClient.getContractEvents({
    address,
    abi: guardianAbi,
    eventName: "LicenseGranted",
    fromBlock,
    toBlock,
  });
  return Promise.all(
    logs.map(async (log) => ({
      labelhash: log.args.labelhash!,
      label: log.args.label!,
      zoneHash: log.args.zoneId!,
      expiresAt: Number(log.args.expiry!) * 1000,
      roles: decodeRoles(log.args.rolesBitmap!),
      tx: log.transactionHash,
      at: await blockTimestamp(log.blockNumber),
      blockNumber: log.blockNumber,
    })),
  );
});

export const fetchRevokeLogs = incrementalScan<RevokeLog>(async (address, fromBlock, toBlock) => {
  const logs = await publicClient.getContractEvents({
    address,
    abi: guardianAbi,
    eventName: "LicenseRevoked",
    fromBlock,
    toBlock,
  });
  return Promise.all(
    logs.map(async (log) => ({
      id: `${log.transactionHash}-${log.logIndex}`,
      labelhash: log.args.labelhash!,
      reason: fromBytes32Text(log.args.reasonCode!),
      source: fromBytes32Text(log.args.source!),
      caller: log.args.caller!,
      tx: log.transactionHash,
      at: await blockTimestamp(log.blockNumber),
      blockNumber: log.blockNumber,
    })),
  );
});

/**
 * Calls onEvent when a new revocation appears. Polls the log scan rather than using RPC filters,
 * because public Sepolia endpoints drop filters between calls. A no-op when no guardian is set.
 */
export function watchRevocations(onEvent: () => void, onError: (e: Error) => void): () => void {
  try {
    guardianAddress();
  } catch {
    return () => {};
  }
  let known: number | null = null;
  const check = () =>
    fetchRevokeLogs()
      .then((logs) => {
        if (known !== null && logs.length !== known) onEvent();
        known = logs.length;
      })
      .catch(onError);
  void check();
  const timer = setInterval(check, REVOCATION_POLL_MS);
  return () => clearInterval(timer);
}
