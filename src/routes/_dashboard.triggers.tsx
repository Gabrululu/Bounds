import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CloudLightning, MapPinned, OctagonX, Radio, ShieldBan, Zap } from "lucide-react";
import {
  listCreRuns,
  listRevocationEvents,
  listWorkflows,
  getTriggerTimeline,
} from "@/services/decisions";
import {
  CopyValue,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Mono,
  PageHeader,
  TxLink,
  fmtDateTime,
  fmtTime,
} from "@/components/bounds/shared";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dashboard/triggers")({
  head: () => ({
    meta: [
      { title: "External triggers — Bounds" },
      {
        name: "description",
        content: "Chainlink CRE workflows that can revoke robot licenses automatically.",
      },
      { property: "og:title", content: "External triggers — Bounds" },
      {
        property: "og:description",
        content: "Chainlink CRE workflows that can revoke robot licenses automatically.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Triggers,
});

const ICON = { weather: CloudLightning, zone: MapPinned, sanctions: ShieldBan };
const STAGE = {
  trigger: {
    icon: Radio,
    cls: "bg-primary/15 text-primary-text ring-primary/40",
    label: "Trigger",
  },
  revocation: { icon: Zap, cls: "bg-warning/15 text-warning ring-warning/40", label: "Revocation" },
  "safe-stop": {
    icon: OctagonX,
    cls: "bg-destructive/15 text-destructive ring-destructive/40",
    label: "Safe-stop",
  },
};

function Triggers() {
  const wf = useQuery({ queryKey: ["workflows"], queryFn: listWorkflows });
  const tl = useQuery({ queryKey: ["timeline"], queryFn: getTriggerTimeline });
  const revocations = useQuery({ queryKey: ["revocations"], queryFn: listRevocationEvents });
  const runs = useQuery({
    queryKey: ["cre-runs"],
    queryFn: () => listCreRuns(),
    refetchInterval: 60_000,
  });
  const latestRobotId = tl.data?.[0]?.robotId;

  return (
    <>
      <PageHeader
        title="External triggers"
        description="Chainlink CRE workflows that revoke licenses when the outside world changes. Read-only: workflows run outside this app."
      />
      <div className="mb-6 rounded-2xl border border-border bg-card">
        {wf.isLoading ? (
          <ListSkeleton rows={3} />
        ) : wf.isError ? (
          <ErrorState message={wf.error.message} onRetry={() => wf.refetch()} />
        ) : !wf.data?.length ? (
          <EmptyState
            title="No workflow runs recorded"
            hint="Runs appear here when your script writes to the cre_runs table."
          />
        ) : (
          <ul className="divide-y divide-border">
            {wf.data.map((w) => {
              const I = ICON[w.kind];
              return (
                <li
                  key={w.id}
                  className="grid grid-cols-[auto_1fr_160px_140px_220px] items-center gap-6 px-5 py-4"
                >
                  <div className="flex size-9 items-center justify-center rounded-md bg-muted">
                    <I className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{w.name}</p>
                    <p className="text-xs text-muted-foreground">{w.description}</p>
                  </div>
                  <div className="text-xs">
                    <p className="text-muted-foreground">Last run</p>
                    <p>{fmtDateTime(w.lastRunAt)}</p>
                  </div>
                  <div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                        w.result === "fired"
                          ? "bg-destructive/12 text-destructive ring-destructive/30"
                          : w.result === "error"
                            ? "bg-warning/12 text-warning ring-warning/30"
                            : "bg-success/12 text-success ring-success/30",
                      )}
                    >
                      {w.result === "fired"
                        ? "Fired"
                        : w.result === "error"
                          ? "Error"
                          : "No action"}
                    </span>
                  </div>
                  <div className="text-xs">
                    <p className="text-muted-foreground">Revocation tx</p>
                    {w.revocationTx ? (
                      <TxLink hash={w.revocationTx} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-medium">Latest firing</p>
        <p className="mb-6 text-xs text-muted-foreground">trigger → revocation → safe-stop</p>
        {tl.isLoading ? (
          <ListSkeleton rows={3} />
        ) : tl.isError ? (
          <ErrorState message={tl.error.message} onRetry={() => tl.refetch()} />
        ) : !tl.data?.length ? (
          <EmptyState title="No revocation recorded yet" />
        ) : (
          <ol className="relative grid grid-cols-3 gap-6">
            <div className="absolute left-[16%] right-[16%] top-5 h-px bg-border" />
            {tl.data.map((e, i) => {
              const s = STAGE[e.stage];
              const seconds = (e.at - tl.data[0]!.at) / 1000;
              const delta = i ? `${seconds < 0 ? "" : "+"}${seconds.toFixed(1)}s` : "t₀";
              return (
                <li key={e.stage} className="relative flex flex-col items-center text-center">
                  <div
                    className={cn(
                      "relative z-10 flex size-10 items-center justify-center rounded-full ring-1 ring-inset bg-card",
                      s.cls,
                    )}
                  >
                    <s.icon className="size-4" />
                  </div>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide">{s.label}</p>
                  <Mono className="text-muted-foreground">
                    {fmtTime(e.at)} · {delta}
                  </Mono>
                  <p className="mt-2 max-w-xs text-sm">{e.label}</p>
                  <div className="mt-2">
                    {e.stage === "revocation" ? (
                      <TxLink hash={e.ref} />
                    ) : (
                      <Mono className="text-muted-foreground">{e.ref}</Mono>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {latestRobotId && (
          <div className="mt-6 text-right">
            <Link
              to="/robots/$robotId"
              params={{ robotId: latestRobotId }}
              className="text-sm text-primary-text hover:underline"
            >
              View robot →
            </Link>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-sm font-medium">LicenseRevoked events</p>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-success" /> Watching the
            guardian
          </span>
        </div>
        {revocations.isLoading ? (
          <ListSkeleton rows={3} />
        ) : revocations.isError ? (
          <ErrorState message={revocations.error.message} onRetry={() => revocations.refetch()} />
        ) : !revocations.data?.length ? (
          <EmptyState title="No LicenseRevoked events" />
        ) : (
          <ul className="divide-y divide-border">
            {revocations.data.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[150px_minmax(0,1fr)_170px_150px] items-center gap-4 px-5 py-3 text-sm"
              >
                <span className="text-xs text-muted-foreground">{fmtDateTime(e.at)}</span>
                <div className="min-w-0">
                  <Mono className="block truncate">{e.ens ?? e.robotId}</Mono>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.reason || "No reason given"}
                  </p>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Source </span>
                  <CopyValue value={e.source} head={6} tail={4} />
                </div>
                <div className="text-right">
                  <TxLink hash={e.tx} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card">
        <p className="border-b border-border px-5 py-3 text-sm font-medium">CRE run history</p>
        {runs.isLoading ? (
          <ListSkeleton rows={3} />
        ) : runs.isError ? (
          <ErrorState message={runs.error.message} onRetry={() => runs.refetch()} />
        ) : !runs.data?.length ? (
          <EmptyState
            title="No runs recorded"
            hint="Your script writes these to the cre_runs table."
          />
        ) : (
          <ul className="divide-y divide-border">
            {runs.data.map((run) => (
              <li
                key={run.id}
                className="grid grid-cols-[150px_minmax(0,1fr)_100px_150px] items-center gap-4 px-5 py-3 text-sm"
              >
                <span className="text-xs text-muted-foreground">{fmtDateTime(run.runAt)}</span>
                <div className="min-w-0">
                  <p className="truncate">{run.workflowName}</p>
                  {run.detail && (
                    <p className="truncate text-xs text-muted-foreground">{run.detail}</p>
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium",
                    run.result === "fired"
                      ? "text-destructive"
                      : run.result === "error"
                        ? "text-warning"
                        : "text-success",
                  )}
                >
                  {run.result === "fired"
                    ? "Fired"
                    : run.result === "error"
                      ? "Error"
                      : "No action"}
                </span>
                <div className="text-right">
                  {run.revocationTx ? (
                    <TxLink hash={run.revocationTx} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
