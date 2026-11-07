import { isAddress, type Address } from "viem";
import { emit } from "./events";

export const ENS_TEXT_KEYS = {
  statusHash: "bounds.statusHash",
  expiry: "bounds.expiry",
  model: "bounds.model",
} as const;

export const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";
export const ZG_CHAIN_EXPLORER = "https://chainscan-galileo.0g.ai";
export const ZG_STORAGE_EXPLORER = "https://storagescan-galileo.0g.ai";

/** Thrown when something the user must set up is missing, so screens can say exactly what. */
export class ConfigError extends Error {}

export interface Settings {
  guardianAddress: string;
  /** Optional. grantLicense goes here when set, otherwise to the guardian. */
  registrarAddress: string;
  /** Parent ENS name, e.g. acme.eth. Robots are subnames of it. */
  ensParent: string;
  /** Subname labels of the fleet. A labelhash can't be reversed, so labels must be known. */
  robotLabels: string[];
  /** Block the guardian was deployed at. Without it, log scans cover the last 30 days only. */
  deployBlock: string;
}

const STORAGE_KEY = "bounds.settings.v1";
const env = import.meta.env;

const defaults = (): Settings => ({
  guardianAddress: env["VITE_GUARDIAN_ADDRESS"] ?? "",
  registrarAddress: env["VITE_REGISTRAR_ADDRESS"] ?? "",
  ensParent: env["VITE_ENS_PARENT"] ?? "",
  robotLabels: parseLabels(env["VITE_ROBOT_LABELS"] ?? ""),
  deployBlock: env["VITE_GUARDIAN_DEPLOY_BLOCK"] ?? "",
});

export function parseLabels(raw: string): string[] {
  const labels = raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(labels)];
}

function readStored(): Partial<Settings> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Settings>;
  } catch {
    return {};
  }
}

let cached: Settings | null = null;

/** Values saved in /settings win over env defaults. */
export function getSettings(): Settings {
  if (!cached) cached = { ...defaults(), ...readStored() };
  return cached;
}

export function saveSettings(patch: Partial<Settings>) {
  const next = { ...getSettings(), ...patch };
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: settings still apply for this session.
  }
  emit();
}

export function guardianAddress(): Address {
  const a = getSettings().guardianAddress;
  if (!a || !isAddress(a))
    throw new ConfigError("Guardian address is not set. Add it in Settings.");
  return a;
}

/** grantLicense target: registrar when configured, otherwise the guardian. */
export function grantTargetAddress(): Address {
  const r = getSettings().registrarAddress;
  return r && isAddress(r) ? r : guardianAddress();
}

export const SUPABASE_URL: string = env["VITE_SUPABASE_URL"] ?? "";
export const SUPABASE_ANON_KEY: string = env["VITE_SUPABASE_ANON_KEY"] ?? "";
export const SEPOLIA_RPC: string | undefined = env["VITE_SEPOLIA_RPC"] || undefined;
export const WALLETCONNECT_PROJECT_ID: string = env["VITE_WALLETCONNECT_PROJECT_ID"] ?? "";

const EXPORTS_KEY = "bounds.reportsExported";

/** Per-browser count. There is no server-side record of exports. */
export function getExportCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(EXPORTS_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function incrementExportCount() {
  try {
    window.localStorage.setItem(EXPORTS_KEY, String(getExportCount() + 1));
  } catch {
    // Storage blocked: the count simply doesn't persist.
  }
}
