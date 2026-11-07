/**
 * `expired` and `unlicensed` have no mock equivalent: on chain a lease can lapse without being
 * revoked, and a subname can exist with no license. Showing either as "revoked" would be false.
 */
export type RobotStatus =
  "authorized" | "expiring" | "expired" | "revoked" | "safe-stop" | "unlicensed";
export type Permission = "move" | "manipulate" | "enter-shared-area";
export type DecisionKind = "CONTINUE" | "SLOW" | "STOP";

export interface Zone {
  id: string;
  name: string;
  /** meters */
  width: number;
  height: number;
  sharedArea?: { x: number; y: number; w: number; h: number };
}

export interface Robot {
  /** labelhash of the ENS label. ENS token IDs can regenerate, so they are never used as keys. */
  id: string;
  label: string;
  ens: string;
  model: string;
  status: RobotStatus;
  zoneId: string;
  leaseExpiresAt: number;
  /** null until the robot has a stored decision. */
  lastDecision: DecisionKind | "UNREACHABLE" | null;
  lastRequestId: string | null;
  permissions: Permission[];
  /** ENS text record. Only hashes, state and expiry live in text records. */
  statusHash: string | null;
  ensAddress: string | null;
}

export interface Decision {
  id: string;
  robotId: string;
  at: number;
  kind: DecisionKind | "UNREACHABLE";
  reason: string;
  requestId: string | null;
  teeVerified: boolean;
  model?: string | null;
}

export interface PermissionGrant {
  role: Permission;
  grantedAt: number;
  grantTx: string;
  revokedAt: number | null;
  revokeTx: string | null;
}

export interface Episode {
  id: string;
  robotId: string;
  startedAt: number;
  durationSec: number;
  decisions: number;
  rootHash: string;
  /** Transaction on the 0G chain that submitted the file to 0G Storage. */
  txHash: string | null;
  /** 0G Storage sequence number. The storage explorer links files by this, not by root hash. */
  txSeq: number | null;
  /** Transaction that recorded the root hash in EvidenceAnchor. Null when not anchored. */
  anchorTx: string | null;
}

export interface Alert {
  id: string;
  robotId: string;
  at: number;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface TriggerWorkflow {
  id: string;
  name: string;
  kind: "weather" | "zone" | "sanctions";
  description: string;
  lastRunAt: number;
  result: "no-action" | "fired" | "error";
  revocationTx: string | null;
  affectedRobotId: string | null;
}

export interface CreRun {
  id: string;
  workflowId: string;
  workflowName: string;
  kind: TriggerWorkflow["kind"];
  runAt: number;
  result: TriggerWorkflow["result"];
  revocationTx: string | null;
  affectedRobotId: string | null;
  detail: string | null;
}

export interface RevocationEvent {
  id: string;
  robotId: string;
  /** Resolved from grant logs and configured labels; null if this labelhash is not known. */
  ens: string | null;
  reason: string;
  source: string;
  caller: string;
  tx: string;
  at: number;
}

export interface TimelineEvent {
  at: number;
  stage: "trigger" | "revocation" | "safe-stop";
  label: string;
  ref: string;
  robotId?: string;
}

export interface FleetStats {
  activeLeases: number;
  revokedToday: number;
  /** null when Supabase is not configured. */
  decisionsToday: number | null;
  reportsExported: number;
}

export interface EvidenceSource {
  label: string;
  ref: string;
  type: "hash" | "tx";
  /** Explorer link. Absent for values with no public page, such as 0G request IDs. */
  href?: string;
}

export interface EvidenceSection {
  id: string;
  title: string;
  article: string;
  description: string;
  present: boolean;
  status: "present" | "missing";
  /** Why the section is missing or incomplete, when a source failed or was only partly scanned. */
  note?: string;
  sources: EvidenceSource[];
  retention?: { requiredDays: number; coveredDays: number };
}

export interface EvidenceReport {
  robotId: string;
  ens: string;
  from: number;
  to: number;
  generatedAt: number;
  sections: EvidenceSection[];
  /** Raw records behind the sections, included in the JSON export. */
  records: {
    decisions: Decision[];
    episodes: Episode[];
    grants: PermissionGrant[];
    revocations: RevocationEvent[];
    creRuns: CreRun[];
  };
}

export interface GrantInput {
  ens: string;
  /** Address of the robot that will hold the license. */
  robot: string;
  zoneId: string;
  durationHours: 1 | 8 | 24;
  permissions: Permission[];
}

export interface EpisodeVerification {
  ok: boolean;
  checkedAt: number;
  reason?: string;
}
