// POST /functions/v1/episode/upload  Headers: x-bounds-secret. Body: episode JSON.
// POST /functions/v1/episode/verify  Public. Body: { rootHash }. Only known root hashes.
import { createClient } from "npm:@supabase/supabase-js@2";
import { keccak256, labelhash, stringToBytes } from "npm:viem@2";
import { Indexer, MemData } from "npm:@0gfoundation/0g-storage-ts-sdk@1.2.13";
import { Contract, JsonRpcProvider, Wallet } from "npm:ethers@6.13.1";
import {
  type EpisodeInput,
  ROOT_HASH,
  parseEpisode,
  verifyRootHash,
} from "../_shared/episode-core.ts";
import { corsHeaders, json, readJson, secretMatches } from "../_shared/http.ts";

// Edge Functions allow about 2s of CPU per request. Merkle hashing costs roughly 100 ms per MB on
// top of loading the SDK, so episodes are capped well below where that budget becomes a problem.
const MAX_EPISODE_BYTES = 1024 * 1024;
const ANCHOR_ABI = [
  "function anchorEpisode(bytes32 labelhash, bytes32 zgRootHash, bytes32 decisionsHash, uint64 timestamp)",
];

const env = (name: string) => Deno.env.get(name);
const RPC = () => env("ZEROG_RPC") ?? "https://evmrpc-testnet.0g.ai";
const INDEXER = () => env("ZEROG_INDEXER") ?? "https://indexer-storage-testnet-turbo.0g.ai";

const database = () =>
  createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

/**
 * Records the root hash in EvidenceAnchor, if one is configured. A failure here does not undo the
 * upload: the file is stored either way, so the response reports the anchor as missing instead.
 */
async function anchorEpisode(
  signer: Wallet,
  episode: EpisodeInput,
  rootHash: string,
): Promise<{ tx: string | null; error?: string }> {
  const address = env("EVIDENCE_ANCHOR_ADDRESS");
  if (!address) return { tx: null };
  try {
    const anchor = new Contract(address, ANCHOR_ABI, signer);
    const sent = await anchor.anchorEpisode(
      labelhash(episode.robotLabel),
      rootHash,
      keccak256(stringToBytes(JSON.stringify(episode.decisions))),
      BigInt(Math.floor(Date.parse(episode.startedAt) / 1000)),
    );
    const receipt = await sent.wait(1);
    return { tx: receipt.hash };
  } catch (error) {
    console.error("Episode anchor failed", (error as Error).message);
    return { tx: null, error: "Episode stored, but anchoring its root hash failed." };
  }
}

async function upload(request: Request, cors: Record<string, string>): Promise<Response> {
  if (!secretMatches(env("BOUNDS_API_SECRET"), request.headers.get("x-bounds-secret"))) {
    return json({ error: "Unauthorized" }, 401, cors);
  }
  const privateKey = env("ZEROG_PRIVATE_KEY");
  if (!privateKey) return json({ error: "ZEROG_PRIVATE_KEY is not set." }, 500, cors);

  const parsed = parseEpisode(await readJson(request, MAX_EPISODE_BYTES));
  if ("error" in parsed) return json({ error: parsed.error }, 400, cors);
  const { episode } = parsed;

  const signer = new Wallet(privateKey, new JsonRpcProvider(RPC()));
  // finalityRequired off: waiting for finality can outlast the wall clock limit. Verify reports
  // "File not finalized" until the network catches up.
  const [result, error] = await new Indexer(INDEXER()).upload(
    new MemData(new TextEncoder().encode(JSON.stringify(episode))),
    RPC(),
    signer as never,
    { finalityRequired: false },
  );
  if (error || !("rootHash" in result)) {
    console.error("0G upload failed", error?.message);
    return json(
      { error: `0G upload failed: ${error?.message ?? "unexpected response"}` },
      502,
      cors,
    );
  }

  const anchor = await anchorEpisode(signer, episode, result.rootHash);

  const { error: dbError } = await database()
    .from("episodes")
    .insert({
      robot_label: episode.robotLabel,
      labelhash: labelhash(episode.robotLabel),
      started_at: episode.startedAt,
      duration_sec: episode.durationSec,
      decision_count: episode.decisions.length,
      root_hash: result.rootHash,
      tx_hash: result.txHash || null,
      tx_seq: result.txSeq ?? null,
      anchor_tx: anchor.tx,
    });
  if (dbError) console.error("episodes insert failed", dbError.message);

  return json(
    {
      rootHash: result.rootHash,
      txHash: result.txHash,
      txSeq: result.txSeq,
      anchorTx: anchor.tx,
      ...(anchor.error ? { anchorError: anchor.error } : {}),
      stored: !dbError,
    },
    200,
    cors,
  );
}

async function verify(request: Request, cors: Record<string, string>): Promise<Response> {
  const body = (await readJson(request, 1024)) as { rootHash?: unknown } | null;
  const rootHash = body?.rootHash;
  if (typeof rootHash !== "string" || !ROOT_HASH.test(rootHash))
    return json({ ok: false, reason: "Invalid root hash." }, 400, cors);

  // This endpoint is public, so it must not become a free download proxy for arbitrary files.
  const { data, error } = await database()
    .from("episodes")
    .select("id")
    .eq("root_hash", rootHash)
    .maybeSingle();
  if (error) return json({ error: "Episode lookup failed." }, 502, cors);
  if (!data) return json({ ok: false, reason: "Unknown episode root hash." }, 404, cors);

  const indexer = new Indexer(INDEXER());
  const result = await verifyRootHash(rootHash, {
    download: async (root) => {
      const [blob, err] = await indexer.downloadToBlob(root, { proof: true });
      return err ? [null, err] : [new Uint8Array(await blob.arrayBuffer()), null];
    },
    computeRoot: async (bytes) => {
      const [tree, err] = await new MemData(bytes).merkleTree();
      return err || !tree ? null : tree.rootHash();
    },
  });
  return json(result, 200, cors);
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request, env("ALLOWED_ORIGINS"));
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  const { pathname } = new URL(request.url);
  try {
    if (pathname.endsWith("/upload")) return await upload(request, cors);
    if (pathname.endsWith("/verify")) return await verify(request, cors);
  } catch (error) {
    console.error(error);
    return json({ error: "Episode request failed." }, 500, cors);
  }
  return json({ error: "Not found" }, 404, cors);
});
