import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { SEPOLIA_RPC } from "./config";

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC, { batch: { wait: 20 } }),
  batch: { multicall: true },
  pollingInterval: 12_000,
});

export const SEPOLIA_BLOCK_SECONDS = 12;

/**
 * Walks [from, to] in chunks, because RPCs cap the range of eth_getLogs. On failure the chunk is
 * halved and retried; a failure at the minimum size is a real error and is thrown.
 */
export async function scanRange<T>(
  from: bigint,
  to: bigint,
  fetchChunk: (from: bigint, to: bigint) => Promise<T[]>,
  initialStep = 5_000n,
  minStep = 100n,
): Promise<T[]> {
  const out: T[] = [];
  let step = initialStep;
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + step - 1n > to ? to : cursor + step - 1n;
    try {
      out.push(...(await fetchChunk(cursor, end)));
      cursor = end + 1n;
    } catch (error) {
      if (step <= minStep) throw error;
      step = step / 2n > minStep ? step / 2n : minStep;
    }
  }
  return out;
}
