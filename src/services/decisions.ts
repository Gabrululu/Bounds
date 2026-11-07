import { labelhash } from "viem";
import type {
  CreRun,
  Decision,
  Episode,
  EpisodeVerification,
  RevocationEvent,
  TimelineEvent,
  TriggerWorkflow,
} from "./types";
import { getSettings } from "./config";
import { HOUR } from "./events";
import { fetchGrantLogs, fetchRevokeLogs } from "./guardian";
import { getSupabase, requireSupabase } from "./supabase";

interface DecisionRow {
  id: string;
  labelhash: string;
  decided_at: string;
  kind: Decision["kind"];
  reason: string;
  request_id: string | null;
  tee_verified: boolean;
  model: string | null;
}

const DECISION_COLUMNS = "id,labelhash,decided_at,kind,reason,request_id,tee_verified,model";

const toDecision = (row: DecisionRow): Decision => ({
  id: row.id,
  robotId: row.labelhash,
  at: new Date(row.decided_at).getTime(),
  kind: row.kind,
  reason: row.reason,
  requestId: row.request_id,
  teeVerified: row.tee_verified,
  model: row.model,
});

export async function listDecisions(robotId: string): Promise<Decision[]> {
  const { data, error } = await requireSupabase()
    .from("decisions")
    .select(DECISION_COLUMNS)
    .eq("labelhash", robotId)
    .order("decided_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  return (data as DecisionRow[]).map(toDecision);
}

export async function latestDecision(robotId: string): Promise<Decision | null> {
  const client = getSupabase();
  if (!client) return null;
  const { data, error } = await client
    .from("decisions")
    .select(DECISION_COLUMNS)
    .eq("labelhash", robotId)
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toDecision(data as DecisionRow) : null;
}

export async function listRecentAlertDecisions(robotId: string): Promise<Decision[]> {
  const { data, error } = await requireSupabase()
    .from("decisions")
    .select(DECISION_COLUMNS)
    .eq("labelhash", robotId)
    .in("kind", ["STOP", "UNREACHABLE"])
    .order("decided_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data as DecisionRow[]).map(toDecision);
}

export async function listDecisionsInRange(
  robotId: string,
  from: number,
  to: number,
): Promise<Decision[]> {
  const { data, error } = await requireSupabase()
    .from("decisions")
    .select(DECISION_COLUMNS)
    .eq("labelhash", robotId)
    .gte("decided_at", new Date(from).toISOString())
    .lte("decided_at", new Date(to).toISOString())
    .order("decided_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data as DecisionRow[]).map(toDecision);
}

/** Timestamp of the robot's first stored decision, used for the retention figure. */
export async function firstDecisionAt(robotId: string): Promise<number | null> {
  const { data, error } = await requireSupabase()
    .from("decisions")
    .select("decided_at")
    .eq("labelhash", robotId)
    .order("decided_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? new Date((data as { decided_at: string }).decided_at).getTime() : null;
}

export async function countDecisionsSince(since: number): Promise<number> {
  const { count, error } = await requireSupabase()
    .from("decisions")
    .select("id", { count: "exact", head: true })
    .gte("decided_at", new Date(since).toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Live feed from Supabase Realtime. Returns an unsubscribe fn. */
export function streamDecisions(
  robotId: string,
  active: boolean,
  onDecision: (d: Decision) => void,
) {
  const client = getSupabase();
  if (!active || !client) return () => {};
  const channel = client
    .channel(`decisions:${robotId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "decisions", filter: `labelhash=eq.${robotId}` },
      (payload) => onDecision(toDecision(payload.new as DecisionRow)),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

export async function decisionsPerHour(): Promise<
  { hour: string; continue: number; slow: number; stop: number }[]
> {
  const { data, error } = await requireSupabase().rpc("decisions_per_hour", { hours: 12 });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { bucket: string; kind: Decision["kind"]; total: number }[];
  const currentHour = new Date().setMinutes(0, 0, 0);
  return Array.from({ length: 12 }, (_, i) => {
    const start = currentHour - (11 - i) * HOUR;
    const inBucket = rows.filter((r) => new Date(r.bucket).getTime() === start);
    const sum = (...kinds: Decision["kind"][]) =>
      inBucket.filter((r) => kinds.includes(r.kind)).reduce((n, r) => n + Number(r.total), 0);
    return {
      hour: `${String(new Date(start).getHours()).padStart(2, "0")}:00`,
      continue: sum("CONTINUE"),
      slow: sum("SLOW"),
      // A missing decision halts the robot, so it counts with the stops.
      stop: sum("STOP", "UNREACHABLE"),
    };
  });
}

interface EpisodeRow {
  id: string;
  labelhash: string;
  started_at: string;
  duration_sec: number;
  decision_count: number;
  root_hash: string;
  tx_hash: string | null;
  tx_seq: number | null;
  anchor_tx: string | null;
}

export async function listEpisodes(robotId: string): Promise<Episode[]> {
  const { data, error } = await requireSupabase()
    .from("episodes")
    .select(
      "id,labelhash,started_at,duration_sec,decision_count,root_hash,tx_hash,tx_seq,anchor_tx",
    )
    .eq("labelhash", robotId)
    .order("started_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as EpisodeRow[]).map((row) => ({
    id: row.id,
    robotId: row.labelhash,
    startedAt: new Date(row.started_at).getTime(),
    durationSec: row.duration_sec,
    decisions: row.decision_count,
    rootHash: row.root_hash,
    txHash: row.tx_hash,
    txSeq: row.tx_seq,
    anchorTx: row.anchor_tx,
  }));
}

export async function verifyEpisodeHash(episodeId: string): Promise<EpisodeVerification> {
  const client = requireSupabase();
  const { data: episode, error } = await client
    .from("episodes")
    .select("root_hash")
    .eq("id", episodeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!episode) throw new Error("Episode not found");
  const { data, error: fnError } = await client.functions.invoke<{ ok: boolean; reason?: string }>(
    "episode/verify",
    {
      body: { rootHash: (episode as { root_hash: string }).root_hash },
    },
  );
  if (fnError) throw new Error(`Verification service failed: ${fnError.message}`);
  return {
    ok: data?.ok === true,
    checkedAt: Date.now(),
    ...(data?.reason ? { reason: data.reason } : {}),
  };
}

interface CreRunRow {
  id: string;
  workflow_id: string;
  workflow_name: string;
  kind: TriggerWorkflow["kind"];
  description: string;
  run_at: string;
  result: TriggerWorkflow["result"];
  revocation_tx: string | null;
  affected_labelhash: string | null;
  detail: string | null;
}

async function fetchCreRunRows(limit: number): Promise<CreRunRow[]> {
  const { data, error } = await requireSupabase()
    .from("cre_runs")
    .select(
      "id,workflow_id,workflow_name,kind,description,run_at,result,revocation_tx,affected_labelhash,detail",
    )
    .order("run_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data as CreRunRow[];
}

const toCreRun = (row: CreRunRow): CreRun => ({
  id: row.id,
  workflowId: row.workflow_id,
  workflowName: row.workflow_name,
  kind: row.kind,
  runAt: new Date(row.run_at).getTime(),
  result: row.result,
  revocationTx: row.revocation_tx,
  affectedRobotId: row.affected_labelhash,
  detail: row.detail,
});

export async function listCreRuns(limit = 50): Promise<CreRun[]> {
  return (await fetchCreRunRows(limit)).map(toCreRun);
}

/** The workflows themselves run outside the app; this is the latest run of each. */
export async function listWorkflows(): Promise<TriggerWorkflow[]> {
  const latest = new Map<string, CreRunRow>();
  for (const row of await fetchCreRunRows(500))
    if (!latest.has(row.workflow_id)) latest.set(row.workflow_id, row);
  return [...latest.values()].map((row) => ({
    id: row.workflow_id,
    name: row.workflow_name,
    kind: row.kind,
    description: row.description,
    lastRunAt: new Date(row.run_at).getTime(),
    result: row.result,
    revocationTx: row.revocation_tx,
    affectedRobotId: row.affected_labelhash,
  }));
}

async function ensByLabelhash(): Promise<Map<string, string>> {
  const { ensParent, robotLabels } = getSettings();
  const grants = await fetchGrantLogs();
  const labels = [...robotLabels, ...grants.map((g) => g.label)];
  return new Map(labels.map((label) => [labelhash(label) as string, `${label}.${ensParent}`]));
}

export async function listRevocationEvents(): Promise<RevocationEvent[]> {
  const [names, logs] = await Promise.all([ensByLabelhash(), fetchRevokeLogs()]);
  return logs
    .map((log) => ({
      id: log.id,
      robotId: log.labelhash,
      ens: names.get(log.labelhash) ?? null,
      reason: log.reason,
      source: log.source,
      caller: log.caller,
      tx: log.tx,
      at: log.at,
    }))
    .sort((a, b) => b.at - a.at);
}

/**
 * Latest revocation, joined to the CRE run that caused it and the first halting decision after
 * it. A stage with no real record is left out rather than filled in.
 */
export async function getTriggerTimeline(): Promise<TimelineEvent[]> {
  const [latest] = await listRevocationEvents();
  if (!latest) return [];
  const name = latest.ens ?? `${latest.robotId.slice(0, 10)}…`;
  const events: TimelineEvent[] = [
    {
      at: latest.at,
      stage: "revocation",
      label: `License revoked on-chain for ${name}: ${latest.reason || "no reason given"}`,
      ref: latest.tx,
      robotId: latest.robotId,
    },
  ];
  const client = getSupabase();
  if (client) {
    const { data: run } = await client
      .from("cre_runs")
      .select("id,workflow_name,run_at,detail")
      .eq("revocation_tx", latest.tx)
      .limit(1)
      .maybeSingle();
    if (run) {
      const r = run as { id: string; workflow_name: string; run_at: string; detail: string | null };
      events.unshift({
        at: new Date(r.run_at).getTime(),
        stage: "trigger",
        label: `CRE workflow '${r.workflow_name}'${r.detail ? `: ${r.detail}` : ""}`,
        ref: r.id,
        robotId: latest.robotId,
      });
    }
    const { data: halt } = await client
      .from("decisions")
      .select(DECISION_COLUMNS)
      .eq("labelhash", latest.robotId)
      .in("kind", ["STOP", "UNREACHABLE"])
      .gte("decided_at", new Date(latest.at).toISOString())
      .order("decided_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (halt) {
      const d = toDecision(halt as DecisionRow);
      events.push({
        at: d.at,
        stage: "safe-stop",
        label: `First ${d.kind === "STOP" ? "STOP" : "no-decision"} recorded after revocation`,
        ref: d.requestId ?? d.id,
        robotId: latest.robotId,
      });
    }
  }
  return events;
}

export const RETENTION_DAYS = 365;
