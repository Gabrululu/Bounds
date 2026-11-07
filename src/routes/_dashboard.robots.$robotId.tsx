import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  FileCheck2,
  Info,
  Loader2,
  OctagonX,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getPermissions, getRobot, getZone, listAlerts, revokeLicense } from "@/services/robots";
import {
  listDecisions,
  listEpisodes,
  streamDecisions,
  verifyEpisodeHash,
} from "@/services/decisions";
import type { Decision, Episode } from "@/services/types";
import { DecisionFeed } from "@/components/bounds/DecisionFeed";
import { LiveCanvas } from "@/components/bounds/LiveCanvas";
import {
  CopyValue,
  Countdown,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Mono,
  StatusBadge,
  TxLink,
  fmtDateTime,
  fmtDuration,
} from "@/components/bounds/shared";
import { useTx } from "@/components/bounds/use-services";
import { WalletGate } from "@/components/bounds/WalletControls";
import { ZG_CHAIN_EXPLORER, ZG_STORAGE_EXPLORER } from "@/services/config";
import { clearTx } from "@/services/tx";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dashboard/robots/$robotId")({
  head: ({ params }) => ({
    meta: [
      { title: `Robot ${params.robotId} — Bounds` },
      {
        name: "description",
        content: "Live position, decisions, permissions and episodes for a licensed robot.",
      },
      { property: "og:title", content: `Robot ${params.robotId} — Bounds` },
      {
        property: "og:description",
        content: "Live position, decisions, permissions and episodes for a licensed robot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RobotDetail,
});

function RobotDetail() {
  const { robotId } = Route.useParams();
  const robot = useQuery({ queryKey: ["robot", robotId], queryFn: () => getRobot(robotId) });
  const [confirm, setConfirm] = useState(false);
  const tx = useTx("revoke");
  useEffect(() => () => clearTx("revoke"), []);
  const revoke = useMutation({
    mutationFn: () => revokeLicense(robotId),
    onSuccess: ({ tx: hash }) => {
      setConfirm(false);
      toast.success("License revoked", { description: hash.slice(0, 18) + "…" });
    },
    onError: (error) => toast.error("Revocation failed", { description: error.message }),
  });

  if (robot.isLoading) return <ListSkeleton rows={8} />;
  if (robot.isError)
    return <ErrorState message={robot.error.message} onRetry={() => robot.refetch()} />;
  if (!robot.data)
    return <EmptyState title="Robot not found" hint="It may have been deregistered." />;
  const r = robot.data;
  const zone = getZone(r.zoneId);
  const active = r.status === "authorized" || r.status === "expiring";

  return (
    <>
      <Link
        to="/fleet"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Fleet
      </Link>
      <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{r.ens}</h1>
            <StatusBadge status={r.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>{r.model}</span>
            <span>{zone.name}</span>
            {active && (
              <span className="flex items-center gap-1.5">
                Lease <Countdown to={r.leaseExpiresAt} />
              </span>
            )}
            {r.lastRequestId && (
              <span className="flex items-center gap-1.5">
                Last request <CopyValue value={r.lastRequestId} head={12} tail={4} />
              </span>
            )}
            {r.statusHash && (
              <span className="flex items-center gap-1.5">
                Status hash <CopyValue value={r.statusHash} head={10} tail={4} />
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!active && (
            <Button variant="outline" asChild>
              <Link to="/evidence" search={{ robot: r.id }}>
                <FileCheck2 /> Generate evidence report
              </Link>
            </Button>
          )}
          <Button
            size="lg"
            variant="destructive"
            disabled={r.status === "revoked" || r.status === "unlicensed"}
            onClick={() => setConfirm(true)}
            className="h-11 px-6 text-base font-semibold"
          >
            <OctagonX /> {r.status === "revoked" ? "License revoked" : "Revoke license"}
          </Button>
        </div>
      </div>

      {tx && (
        <div className="mb-6 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            {tx.stage === "signing" || tx.stage === "pending" ? (
              <Loader2 className="size-4 animate-spin text-destructive" />
            ) : (
              <ShieldAlert className="size-4 text-destructive" />
            )}
            {tx.stage === "signing" && "Confirm the revocation in your wallet."}
            {tx.stage === "pending" && "Revocation pending on Sepolia."}
            {tx.stage === "confirmed" && "Revocation confirmed on Sepolia."}
            {tx.stage === "failed" && "Revocation failed. The license was not revoked."}
          </span>
          {tx.hash && <TxLink hash={tx.hash} />}
        </div>
      )}

      <Tabs defaultValue="live">
        <TabsList>
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="episodes">Episodes</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>
        <TabsContent value="live" className="mt-4">
          <LiveTab robotId={r.id} zone={zone} active={active} />
        </TabsContent>
        <TabsContent value="permissions" className="mt-4">
          <PermissionsTab robotId={r.id} />
        </TabsContent>
        <TabsContent value="episodes" className="mt-4">
          <EpisodesTab robotId={r.id} />
        </TabsContent>
        <TabsContent value="alerts" className="mt-4">
          <AlertsTab robotId={r.id} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirm} onOpenChange={(o) => !revoke.isPending && setConfirm(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke license for {r.ens}?</AlertDialogTitle>
            <AlertDialogDescription>
              This submits an on-chain revocation. The robot will engage safe-stop within one
              control cycle and cannot resume until a new license is granted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>Cancel</AlertDialogCancel>
            <WalletGate>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={revoke.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  revoke.mutate();
                }}
              >
                {revoke.isPending ? (
                  <>
                    <Loader2 className="animate-spin" />{" "}
                    {tx?.stage === "pending" ? "Confirming…" : "Check your wallet…"}
                  </>
                ) : (
                  "Revoke & safe-stop"
                )}
              </AlertDialogAction>
            </WalletGate>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LiveTab({
  robotId,
  zone,
  active,
}: {
  robotId: string;
  zone: ReturnType<typeof getZone>;
  active: boolean;
}) {
  const q = useQuery({ queryKey: ["decisions", robotId], queryFn: () => listDecisions(robotId) });
  const [live, setLive] = useState<Decision[]>([]);
  useEffect(
    () => streamDecisions(robotId, active, (d) => setLive((l) => [d, ...l].slice(0, 30))),
    [robotId, active],
  );
  const items = [...live, ...(q.data ?? [])]
    .filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i)
    .slice(0, 40);

  return (
    <div className="grid grid-cols-[1fr_400px] gap-4">
      <div className="relative h-[520px] rounded-2xl border border-border bg-card">
        <div className="absolute left-4 top-3 z-10 flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", active ? "bg-success" : "bg-destructive")} />
          {active ? "Licensed zone — top-down view" : "Not licensed to operate"}
        </div>
        <LiveCanvas zone={zone} active={active} />
      </div>
      <div className="flex h-[520px] flex-col rounded-2xl border border-border bg-card">
        <p className="border-b border-border px-4 py-3 text-sm font-medium">Decision feed</p>
        <div className="flex-1 overflow-y-auto">
          {q.isLoading ? (
            <ListSkeleton />
          ) : q.isError ? (
            <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
          ) : (
            <DecisionFeed items={items} compact />
          )}
        </div>
      </div>
    </div>
  );
}

function PermissionsTab({ robotId }: { robotId: string }) {
  const q = useQuery({ queryKey: ["perms", robotId], queryFn: () => getPermissions(robotId) });
  return (
    <div className="rounded-2xl border border-border bg-card">
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title="No roles granted" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Role</TableHead>
              <TableHead>Granted</TableHead>
              <TableHead>Grant tx</TableHead>
              <TableHead>Revoked</TableHead>
              <TableHead>Revoke tx</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((g, i) => (
              <TableRow key={i}>
                <TableCell className="pl-4">
                  <Mono className="text-sm">{g.role}</Mono>
                </TableCell>
                <TableCell className="text-sm">{fmtDateTime(g.grantedAt)}</TableCell>
                <TableCell>
                  <TxLink hash={g.grantTx} />
                </TableCell>
                <TableCell className="text-sm">
                  {g.revokedAt ? (
                    <span className="text-destructive">{fmtDateTime(g.revokedAt)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {g.revokeTx ? (
                    <TxLink hash={g.revokeTx} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function EpisodesTab({ robotId }: { robotId: string }) {
  const q = useQuery({ queryKey: ["episodes", robotId], queryFn: () => listEpisodes(robotId) });
  return (
    <div className="rounded-2xl border border-border bg-card">
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title="No episodes recorded" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Episode</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Decisions</TableHead>
              <TableHead>0G Storage root hash</TableHead>
              <TableHead className="pr-4 text-right">Integrity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((e) => (
              <EpisodeRow key={e.id} e={e} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function EpisodeRow({ e }: { e: Episode }) {
  const v = useMutation({ mutationFn: () => verifyEpisodeHash(e.id) });
  return (
    <TableRow>
      <TableCell className="pl-4">
        <Mono>{e.id.slice(0, 8)}</Mono>
      </TableCell>
      <TableCell className="text-sm">{fmtDateTime(e.startedAt)}</TableCell>
      <TableCell className="text-sm">{fmtDuration(e.durationSec)}</TableCell>
      <TableCell className="text-sm tabular-nums">{e.decisions.toLocaleString()}</TableCell>
      <TableCell>
        <CopyValue value={e.rootHash} head={10} tail={6} />
        <span className="mt-0.5 flex gap-3 text-xs">
          {e.txSeq !== null && (
            <a
              href={`${ZG_STORAGE_EXPLORER}/submission/${e.txSeq}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary-text underline-offset-4 hover:underline"
            >
              Storage explorer
            </a>
          )}
          {e.txHash && (
            <a
              href={`${ZG_CHAIN_EXPLORER}/tx/${e.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary-text underline-offset-4 hover:underline"
            >
              0G tx
            </a>
          )}
        </span>
      </TableCell>
      <TableCell className="pr-4 text-right">
        {v.data?.ok ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
            <BadgeCheck className="size-4" /> Hash matches
          </span>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" variant="outline" onClick={() => v.mutate()} disabled={v.isPending}>
              {v.isPending ? (
                <>
                  <Loader2 className="animate-spin" /> Verifying
                </>
              ) : v.data || v.isError ? (
                "Verify again"
              ) : (
                "Verify hash"
              )}
            </Button>
            {v.data && (
              <span className="inline-flex max-w-56 items-start gap-1 text-left text-xs text-destructive">
                <OctagonX className="mt-0.5 size-3 shrink-0" /> Failed:{" "}
                {v.data.reason ?? "root hash did not verify"}
              </span>
            )}
            {v.isError && (
              <span className="max-w-56 text-left text-xs text-warning">
                Could not check: {v.error.message}
              </span>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function AlertsTab({ robotId }: { robotId: string }) {
  const q = useQuery({ queryKey: ["alerts", robotId], queryFn: () => listAlerts(robotId) });
  const icon = { info: Info, warning: TriangleAlert, critical: ShieldAlert };
  const tone = { info: "text-primary-text", warning: "text-warning", critical: "text-destructive" };
  return (
    <div className="rounded-2xl border border-border bg-card">
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title="No alerts" hint="All quiet for this robot." />
      ) : (
        <ul className="divide-y divide-border">
          {q.data.map((a) => {
            const I = icon[a.severity];
            return (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                <I className={cn("mt-0.5 size-4", tone[a.severity])} />
                <div className="flex-1 text-sm">{a.message}</div>
                <Mono className="text-muted-foreground">{fmtDateTime(a.at)}</Mono>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
