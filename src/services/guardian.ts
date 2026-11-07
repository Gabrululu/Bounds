// The only module that knows the guardian's ABI shape. If the real ABI differs from the
// placeholder in src/abi/guardian.ts, adapt this file and nothing else.
import { keccak256, stringToBytes, type Address, type Hash } from "viem";
import { simulateContract, writeContract } from "wagmi/actions";
import { guardianAbi } from "@/abi/guardian";
import { sepolia, wagmiConfig } from "@/lib/wagmi";
import { SEPOLIA_BLOCK_SECONDS, publicClient, scanRange } from "./chain";
import { getSettings, grantTargetAddress, guardianAddress } from "./config";
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

export interface OnChainLicense {
  zoneHash: Hash;
  /** ms since epoch; 0 when never granted. */
  expiresAt: number;
  roles: Permission[];
  revoked: boolean;
}

export async function readLicense(labelhash: Hash): Promise<OnChainLicense> {
  const [zoneHash, expiry, roles, revoked] = await publicClient.readContract({
    address: guardianAddress(),
    abi: guardianAbi,
    functionName: "getLicense",
    args: [labelhash],
  });
  return { zoneHash, expiresAt: Number(expiry) * 1000, roles: decodeRoles(roles), revoked };
}

export async function sendGrant(
  account: Address,
  label: string,
  zoneId: string,
  expirySeconds: bigint,
  permissions: Permission[],
): Promise<Hash> {
  // Simulate first so a revert surfaces its reason instead of a failed transaction.
  const { request } = await simulateContract(wagmiConfig, {
    account,
    chainId: sepolia.id,
    address: grantTargetAddress(),
    abi: guardianAbi,
    functionName: "grantLicense",
    args: [label, zoneIdHash(zoneId), expirySeconds, encodeRoles(permissions)],
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
    args: [label],
  });
  return writeContract(wagmiConfig, request);
}

export interface GrantLog {
  labelhash: Hash;
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
  source: string;
  tx: Hash;
  at: number;
  blockNumber: bigint;
}

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
      labelhash: log.args.label!,
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
      labelhash: log.args.label!,
      reason: log.args.reason ?? "",
      source: log.args.source ?? "",
      tx: log.transactionHash,
      at: await blockTimestamp(log.blockNumber),
      blockNumber: log.blockNumber,
    })),
  );
});

/** Live subscription. Returns the unsubscribe function; a no-op when no guardian is configured. */
export function watchRevocations(onEvent: () => void, onError: (e: Error) => void): () => void {
  let address: Address;
  try {
    address = guardianAddress();
  } catch {
    return () => {};
  }
  return publicClient.watchContractEvent({
    address,
    abi: guardianAbi,
    eventName: "LicenseRevoked",
    onLogs: onEvent,
    onError,
  });
}
