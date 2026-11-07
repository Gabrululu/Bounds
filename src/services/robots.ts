import { isAddress, labelhash, type Address, type Hash } from "viem";
import { normalize } from "viem/ens";
import { getAccount } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import type {
  Alert,
  FleetStats,
  GrantInput,
  PermissionGrant,
  Robot,
  RobotStatus,
  Zone,
} from "./types";
import { publicClient } from "./chain";
import { ConfigError, ENS_TEXT_KEYS, getExportCount, getSettings, guardianAddress } from "./config";
import { countDecisionsSince, latestDecision, listRecentAlertDecisions } from "./decisions";
import { HOUR, MIN, emit } from "./events";
import {
  fetchGrantLogs,
  fetchRevokeLogs,
  readLicense,
  sendGrant,
  sendRevoke,
  zoneIdHash,
} from "./guardian";
import { getSupabase } from "./supabase";
import { assertWalletReady, runTx } from "./tx";

export const zones: Zone[] = [
  {
    id: "cell-a",
    name: "Assembly Cell A",
    width: 12,
    height: 8,
    sharedArea: { x: 8, y: 0, w: 4, h: 3 },
  },
  { id: "cell-b", name: "Welding Cell B", width: 10, height: 10 },
  {
    id: "dock-1",
    name: "Loading Dock 1",
    width: 20,
    height: 6,
    sharedArea: { x: 0, y: 4, w: 20, h: 2 },
  },
  { id: "wh-3", name: "Warehouse Aisle 3", width: 30, height: 4 },
];

const zoneByHash = new Map(zones.map((z) => [zoneIdHash(z.id), z.id]));
const EXPIRING_WITHIN = 30 * MIN;
const ZERO_HASH = `0x${"0".repeat(64)}`;

interface FleetEntry {
  id: Hash;
  label: string;
  ens: string;
}

/** Every label with an onchain grant, plus any label added in Settings. */
export async function fleet(): Promise<FleetEntry[]> {
  const { ensParent, robotLabels } = getSettings();
  if (!ensParent) return [];
  const grants = await fetchGrantLogs();
  const labels = new Set([...robotLabels, ...grants.map((g) => g.label)]);
  return [...labels].map((label) => ({
    id: labelhash(label),
    label,
    ens: `${label}.${ensParent}`,
  }));
}

/** Text records and address are best effort: a subname without records is not an RPC failure. */
async function readEns(ens: string) {
  let name: string;
  try {
    name = normalize(ens);
  } catch {
    return { address: null, statusHash: null, expiry: null, model: null };
  }
  const text = (key: string) => publicClient.getEnsText({ name, key }).catch(() => null);
  const [address, statusHash, expiry, model] = await Promise.all([
    publicClient.getEnsAddress({ name }).catch(() => null),
    text(ENS_TEXT_KEYS.statusHash),
    text(ENS_TEXT_KEYS.expiry),
    text(ENS_TEXT_KEYS.model),
  ]);
  return { address, statusHash, expiry, model };
}

function parseEnsExpiry(value: string | null): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

export function deriveStatus(args: {
  revoked: boolean;
  expiresAt: number;
  lastDecision: Robot["lastDecision"];
  now: number;
}): RobotStatus {
  if (args.revoked) return "revoked";
  if (!args.expiresAt) return "unlicensed";
  if (args.expiresAt <= args.now) return "expired";
  if (args.lastDecision === "UNREACHABLE") return "safe-stop";
  return args.expiresAt - args.now < EXPIRING_WITHIN ? "expiring" : "authorized";
}

async function loadRobot(entry: FleetEntry): Promise<Robot> {
  const [license, ens, last] = await Promise.all([
    readLicense(entry.id),
    readEns(entry.ens),
    latestDecision(entry.id).catch(() => null),
  ]);
  // If ENS and the guardian disagree, trust whichever lease ends first.
  const ensExpiry = parseEnsExpiry(ens.expiry);
  const expiresAt =
    license.expiresAt && ensExpiry
      ? Math.min(license.expiresAt, ensExpiry)
      : license.expiresAt || ensExpiry;
  const lastDecision = last?.kind ?? null;
  return {
    id: entry.id,
    label: entry.label,
    ens: entry.ens,
    model: ens.model || "Unregistered",
    status: deriveStatus({ revoked: license.revoked, expiresAt, lastDecision, now: Date.now() }),
    zoneId: zoneByHash.get(license.zoneHash) ?? license.zoneHash,
    leaseExpiresAt: expiresAt,
    lastDecision,
    lastRequestId: last?.requestId ?? null,
    permissions: license.revoked ? [] : license.roles,
    statusHash: ens.statusHash,
    ensAddress: ens.address,
  };
}

export async function listRobots(): Promise<Robot[]> {
  guardianAddress();
  if (!getSettings().ensParent)
    throw new ConfigError("Parent ENS name is not set. Add it in Settings.");
  return Promise.all((await fleet()).map(loadRobot));
}

export async function getRobot(id: string): Promise<Robot | null> {
  guardianAddress();
  const entry = (await fleet()).find((e) => e.id === id);
  return entry ? loadRobot(entry) : null;
}

export function getZone(id: string): Zone {
  const known = zones.find((z) => z.id === id);
  if (known) return known;
  // Never substitute a real zone for one the catalog doesn't know.
  const shortId = id === ZERO_HASH ? "none" : `${id.slice(0, 10)}…`;
  return { id, name: `Unknown zone (${shortId})`, width: 10, height: 10 };
}

export async function listZones() {
  return zones;
}

export async function getPermissions(robotId: string): Promise<PermissionGrant[]> {
  const [grants, revokes] = await Promise.all([fetchGrantLogs(), fetchRevokeLogs()]);
  const revokesForRobot = revokes.filter((r) => r.labelhash === robotId);
  return grants
    .filter((g) => g.labelhash === robotId)
    .sort((a, b) => b.at - a.at)
    .flatMap((g) => {
      const revoke = revokesForRobot.find((r) => r.blockNumber >= g.blockNumber) ?? null;
      return g.roles.map((role) => ({
        role,
        grantedAt: g.at,
        grantTx: g.tx,
        revokedAt: revoke?.at ?? null,
        revokeTx: revoke?.tx ?? null,
      }));
    });
}

export async function listAlerts(robotId: string): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const revokes = await fetchRevokeLogs();
  for (const r of revokes.filter((x) => x.labelhash === robotId)) {
    alerts.push({
      id: r.id,
      robotId,
      at: r.at,
      severity: "critical",
      message: `License revoked by ${r.source}: ${r.reason || "no reason given"}. Tx ${r.tx.slice(0, 10)}…`,
    });
  }
  const robot = await getRobot(robotId);
  if (robot?.status === "expiring") {
    alerts.push({
      id: `exp-${robotId}`,
      robotId,
      at: Date.now(),
      severity: "warning",
      message: "Lease expires in under 30 minutes.",
    });
  }
  if (getSupabase()) {
    for (const d of await listRecentAlertDecisions(robotId)) {
      alerts.push(
        d.kind === "UNREACHABLE"
          ? {
              id: d.id,
              robotId,
              at: d.at,
              severity: "critical",
              message: "0G compute unreachable: safe-stop engaged. No decision was invented.",
            }
          : {
              id: d.id,
              robotId,
              at: d.at,
              severity: "warning",
              message: `Model issued STOP: ${d.reason}`,
            },
      );
    }
  }
  return alerts.sort((a, b) => b.at - a.at);
}

export async function getFleetStats(): Promise<FleetStats> {
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const [robots, revokes, decisionsToday] = await Promise.all([
    listRobots(),
    fetchRevokeLogs(),
    getSupabase() ? countDecisionsSince(startOfDay) : Promise.resolve(null),
  ]);
  return {
    activeLeases: robots.filter((r) => r.status === "authorized" || r.status === "expiring").length,
    revokedToday: revokes.filter((r) => r.at >= startOfDay).length,
    decisionsToday,
    reportsExported: getExportCount(),
  };
}

function connectedAccount() {
  assertWalletReady();
  return getAccount(wagmiConfig).address!;
}

export async function revokeLicense(robotId: string): Promise<{ tx: string }> {
  const entry = (await fleet()).find((e) => e.id === robotId);
  if (!entry) throw new Error("Robot not found");
  const account = connectedAccount();
  const tx = await runTx("revoke", () => sendRevoke(account, entry.label));
  emit();
  return { tx };
}

export async function grantLicense(input: GrantInput): Promise<{ tx: string; robotId: string }> {
  const { ensParent } = getSettings();
  const suffix = `.${ensParent}`;
  if (!ensParent || !input.ens.endsWith(suffix))
    throw new Error(
      `Robot name must be a subname of ${ensParent || "the parent ENS name set in Settings"}.`,
    );
  const label = input.ens.slice(0, -suffix.length);
  if (!/^[a-z0-9-]+$/.test(label))
    throw new Error("Robot label may only contain a-z, 0-9 and hyphens.");
  if (!isAddress(input.robot)) throw new Error("Robot address is not a valid address.");
  const account = connectedAccount();
  const expiry = BigInt(Math.floor((Date.now() + input.durationHours * HOUR) / 1000));
  const tx = await runTx("grant", () =>
    sendGrant(account, label, input.robot as Address, input.zoneId, expiry, input.permissions),
  );
  emit();
  return { tx, robotId: labelhash(label) };
}
