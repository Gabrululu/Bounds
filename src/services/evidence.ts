import type {
  CreRun,
  Decision,
  Episode,
  EvidenceReport,
  EvidenceSection,
  EvidenceSource,
  PermissionGrant,
  RevocationEvent,
} from "./types";
import {
  SEPOLIA_EXPLORER,
  ZG_CHAIN_EXPLORER,
  ZG_STORAGE_EXPLORER,
  incrementExportCount,
} from "./config";
import {
  RETENTION_DAYS,
  firstDecisionAt,
  listCreRuns,
  listDecisionsInRange,
  listEpisodes,
  listRevocationEvents,
} from "./decisions";
import { DAY, emit } from "./events";
import { fetchGrantLogs, scanIsPartial, type GrantLog } from "./guardian";
import { getRobot, getZone, zones } from "./robots";
import { zoneIdHash } from "./guardian";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const txSource = (label: string, ref: string): EvidenceSource => ({
  label,
  ref,
  type: "tx",
  ...(TX_HASH.test(ref) ? { href: `${SEPOLIA_EXPLORER}/tx/${ref}` } : {}),
});

const zgTxSource = (label: string, ref: string): EvidenceSource => ({
  label,
  ref,
  type: "tx",
  ...(TX_HASH.test(ref) ? { href: `${ZG_CHAIN_EXPLORER}/tx/${ref}` } : {}),
});

const rootSource = (episode: Episode): EvidenceSource => ({
  label: "Episode root hash",
  ref: episode.rootHash,
  type: "hash",
  ...(episode.txSeq !== null ? { href: `${ZG_STORAGE_EXPLORER}/submission/${episode.txSeq}` } : {}),
});

interface Fetched<T> {
  data: T;
  error?: string;
}

/** A failed source must read as failed, never as "no evidence exists". */
async function attempt<T>(fetch: () => Promise<T>, fallback: T): Promise<Fetched<T>> {
  try {
    return { data: await fetch() };
  } catch (error) {
    return { data: fallback, error: (error as Error).message };
  }
}

function section(
  base: Omit<EvidenceSection, "present" | "status" | "note">,
  notes: (string | undefined)[],
): EvidenceSection {
  const present = base.sources.length > 0;
  const note = notes.filter(Boolean).join(" ");
  return { ...base, present, status: present ? "present" : "missing", ...(note ? { note } : {}) };
}

const unavailable = (source: string, error?: string) =>
  error ? `${source} unavailable: ${error}.` : undefined;

export async function buildEvidenceReport(
  robotId: string,
  from: number,
  to: number,
): Promise<EvidenceReport> {
  const robot = await getRobot(robotId);
  if (!robot) throw new Error("Robot not found");

  const inRange = (at: number) => at >= from && at <= to;
  const [decisions, episodes, grantLogs, revocations, creRuns, firstAt] = await Promise.all([
    attempt<Decision[]>(() => listDecisionsInRange(robotId, from, to), []),
    attempt<Episode[]>(
      async () => (await listEpisodes(robotId)).filter((e) => inRange(e.startedAt)),
      [],
    ),
    attempt<GrantLog[]>(
      async () => (await fetchGrantLogs()).filter((g) => g.labelhash === robotId && inRange(g.at)),
      [],
    ),
    attempt<RevocationEvent[]>(
      async () =>
        (await listRevocationEvents()).filter((r) => r.robotId === robotId && inRange(r.at)),
      [],
    ),
    attempt<CreRun[]>(
      async () =>
        (await listCreRuns(500)).filter((r) => r.affectedRobotId === robotId && inRange(r.runAt)),
      [],
    ),
    attempt<number | null>(() => firstDecisionAt(robotId), null),
  ]);

  const partialScan = scanIsPartial()
    ? "Guardian deploy block is not set, so only the last 30 days of chain events were scanned."
    : undefined;
  const grantsUnavailable = unavailable("Guardian events", grantLogs.error);
  const revokesUnavailable = unavailable("Guardian events", revocations.error);
  const decisionsUnavailable = unavailable("Decisions table", decisions.error);
  const episodesUnavailable = unavailable("Episodes table", episodes.error);
  const creUnavailable = unavailable("CRE run history", creRuns.error);

  const zoneName = (hash: string) =>
    getZone(zones.find((z) => zoneIdHash(z.id) === hash)?.id ?? hash).name;
  const withRequestId = decisions.data.filter((d) => d.requestId);
  const teeVerified = decisions.data.filter((d) => d.teeVerified).length;
  const models = [...new Set(decisions.data.map((d) => d.model).filter((m): m is string => !!m))];

  const retention =
    firstAt.data !== null
      ? {
          requiredDays: RETENTION_DAYS,
          coveredDays: Math.min(RETENTION_DAYS, Math.max(1, Math.ceil((to - firstAt.data) / DAY))),
        }
      : undefined;

  const sections: EvidenceSection[] = [
    section(
      {
        id: "area",
        title: "Bounded work area",
        article: "Annex III §1.1.2, §1.3.7",
        description: "Zone bound to the robot's license by on-chain grants in this period.",
        sources: grantLogs.data.map((g) => txSource(`Grant: ${zoneName(g.zoneHash)}`, g.tx)),
      },
      [grantsUnavailable, partialScan],
    ),
    section(
      {
        id: "movement",
        title: "Movement limits",
        article: "Annex III §1.3.7, §1.3.8",
        description:
          "Roles granted under the license. Velocity limits are not recorded on-chain and are not covered.",
        sources: grantLogs.data.map((g) =>
          txSource(`Roles: ${g.roles.join(", ") || "none"}`, g.tx),
        ),
      },
      [grantsUnavailable, partialScan],
    ),
    section(
      {
        id: "log",
        title: "Safety-decision log",
        article: "Annex III §1.2.1",
        description: `${decisions.data.length.toLocaleString()} stored decisions and ${episodes.data.length} episode root hashes in this period.`,
        sources: episodes.data.flatMap((e) => [
          rootSource(e),
          ...(e.txHash ? [zgTxSource("0G anchor tx", e.txHash)] : []),
        ]),
        ...(retention ? { retention } : {}),
      },
      [
        decisionsUnavailable,
        episodesUnavailable,
        unavailable("Decisions table", firstAt.error),
        decisions.data.length && !episodes.data.length
          ? "Decisions are stored, but no episode root hash anchors them in this period."
          : undefined,
        decisions.data.length >= 1000
          ? "Listing capped at the latest 1,000 decisions in this period."
          : undefined,
      ],
    ),
    section(
      {
        id: "stop",
        title: "Ability to correct / stop the machine",
        article: "Annex III §1.2.4, §1.1.6",
        description:
          "Revocations recorded by the guardian, and the CRE workflow runs that fired them.",
        sources: [
          ...revocations.data.map((r) =>
            txSource(`Revocation: ${r.reason || "no reason given"}`, r.tx),
          ),
          ...creRuns.data
            .filter((r) => r.revocationTx)
            .map((r) => txSource(`CRE run: ${r.workflowName}`, r.revocationTx!)),
        ],
      },
      [revokesUnavailable, creUnavailable, partialScan],
    ),
    section(
      {
        id: "ai",
        title: "AI logging",
        article: "Annex III §1.1.9",
        description: `${withRequestId.length.toLocaleString()} decisions with a 0G request ID, ${teeVerified.toLocaleString()} TEE-verified.${models.length ? ` Models: ${models.join(", ")}.` : ""}`,
        sources: withRequestId.map((d) => ({
          label: `${d.kind}${d.teeVerified ? " (TEE)" : ""}`,
          ref: d.requestId!,
          type: "hash" as const,
        })),
      },
      [decisionsUnavailable],
    ),
  ];

  const grants: PermissionGrant[] = grantLogs.data.flatMap((g) =>
    g.roles.map((role) => ({
      role,
      grantedAt: g.at,
      grantTx: g.tx,
      revokedAt: null,
      revokeTx: null,
    })),
  );

  return {
    robotId,
    ens: robot.ens,
    from,
    to,
    generatedAt: Date.now(),
    sections,
    records: {
      decisions: decisions.data,
      episodes: episodes.data,
      grants,
      revocations: revocations.data,
      creRuns: creRuns.data,
    },
  };
}

export function markExported() {
  incrementExportCount();
  emit();
}
