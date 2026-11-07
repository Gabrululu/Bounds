// No Deno or npm imports, so vitest can exercise this directly.
const LABEL = /^[a-z0-9-]{1,63}$/;
export const ROOT_HASH = /^0x[0-9a-fA-F]{64}$/;

export interface EpisodeInput {
  robotLabel: string;
  startedAt: string;
  durationSec: number;
  decisions: unknown[];
  requestIds: string[];
  permissionSnapshot: Record<string, unknown>;
}

export function parseEpisode(body: unknown): { episode: EpisodeInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b["robotLabel"] !== "string" || !LABEL.test(b["robotLabel"]))
    return { error: "robotLabel is invalid." };
  if (typeof b["startedAt"] !== "string" || Number.isNaN(Date.parse(b["startedAt"])))
    return { error: "startedAt must be an ISO date." };
  if (
    typeof b["durationSec"] !== "number" ||
    !Number.isInteger(b["durationSec"]) ||
    b["durationSec"] < 0
  )
    return { error: "durationSec must be a non-negative integer." };
  if (!Array.isArray(b["decisions"])) return { error: "decisions must be an array." };
  if (!Array.isArray(b["requestIds"]) || !b["requestIds"].every((r) => typeof r === "string"))
    return { error: "requestIds must be an array of strings." };
  const snapshot = b["permissionSnapshot"];
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot))
    return { error: "permissionSnapshot must be an object." };
  return {
    episode: {
      robotLabel: b["robotLabel"],
      startedAt: b["startedAt"],
      durationSec: b["durationSec"],
      decisions: b["decisions"],
      requestIds: b["requestIds"] as string[],
      permissionSnapshot: snapshot as Record<string, unknown>,
    },
  };
}

export interface VerifyDeps {
  /** Downloads with proof checking on. Returns the bytes, or an error from the storage network. */
  download: (rootHash: string) => Promise<[Uint8Array | null, Error | null]>;
  computeRoot: (bytes: Uint8Array) => Promise<string | null>;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Proof-checked download, then recompute the root from the bytes as an independent check. */
export async function verifyRootHash(rootHash: string, deps: VerifyDeps): Promise<VerifyResult> {
  let bytes: Uint8Array | null;
  let error: Error | null;
  try {
    [bytes, error] = await deps.download(rootHash);
  } catch (thrown) {
    return { ok: false, reason: (thrown as Error).message };
  }
  if (error) return { ok: false, reason: error.message };
  if (!bytes) return { ok: false, reason: "Download returned no data." };
  const computed = await deps.computeRoot(bytes);
  if (computed?.toLowerCase() !== rootHash.toLowerCase())
    return { ok: false, reason: "Downloaded data does not match the root hash." };
  return { ok: true };
}
