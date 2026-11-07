import { getAccount, waitForTransactionReceipt } from "wagmi/actions";
import type { Hash } from "viem";
import { sepolia, wagmiConfig } from "@/lib/wagmi";

export type TxAction = "grant" | "revoke";
export type TxStage = "signing" | "pending" | "confirmed" | "failed";

export interface TxState {
  action: TxAction;
  stage: TxStage;
  hash?: Hash;
}

const states: Partial<Record<TxAction, TxState>> = {};
const listeners = new Set<() => void>();

function set(action: TxAction, state: TxState | undefined) {
  if (state) states[action] = state;
  else delete states[action];
  listeners.forEach((l) => l());
}

export function subscribeTx(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const getTx = (action: TxAction) => states[action];
export const clearTx = (action: TxAction) => set(action, undefined);

export function assertWalletReady() {
  const account = getAccount(wagmiConfig);
  if (!account.isConnected) throw new Error("Connect your wallet first.");
  if (account.chainId !== sepolia.id) throw new Error("Switch your wallet to Sepolia first.");
}

/** Sends a transaction and publishes signing → pending → confirmed, so the UI can show the hash. */
export async function runTx(action: TxAction, send: () => Promise<Hash>): Promise<Hash> {
  set(action, { action, stage: "signing" });
  let hash: Hash | undefined;
  try {
    hash = await send();
    set(action, { action, stage: "pending", hash });
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: sepolia.id });
    if (receipt.status !== "success") throw new Error("Transaction reverted on Sepolia.");
    set(action, { action, stage: "confirmed", hash });
    return hash;
  } catch (error) {
    set(action, { action, stage: "failed", ...(hash ? { hash } : {}) });
    throw new Error(readableError(error), { cause: error });
  }
}

function readableError(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string };
  return e?.shortMessage ?? e?.message ?? "Transaction failed.";
}
