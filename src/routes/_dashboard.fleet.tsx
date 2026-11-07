import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileCheck2, KeyRound, Plus, Search, ShieldOff } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { getFleetStats, getZone, listRobots } from "@/services/robots";
import { decisionsPerHour } from "@/services/decisions";
import { GrantLicenseDrawer } from "@/components/bounds/GrantLicenseDrawer";
import {
  CopyValue,
  Countdown,
  DecisionTag,
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageHeader,
  StatusBadge,
} from "@/components/bounds/shared";

export const Route = createFileRoute("/_dashboard/fleet")({
  head: () => ({
    meta: [
      { title: "Fleet — Bounds" },
      {
        name: "description",
        content: "Live overview of licensed robots, leases and safety decisions.",
      },
      { property: "og:title", content: "Fleet — Bounds" },
      {
        property: "og:description",
        content: "Live overview of licensed robots, leases and safety decisions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Fleet,
});

function Fleet() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const robots = useQuery({ queryKey: ["robots"], queryFn: listRobots });
  const stats = useQuery({ queryKey: ["stats"], queryFn: getFleetStats });
  const chart = useQuery({ queryKey: ["dph"], queryFn: decisionsPerHour, refetchInterval: 60_000 });
  const filtered = useMemo(
    () => (robots.data ?? []).filter((r) => r.ens.includes(q.toLowerCase())),
    [robots.data, q],
  );

  const cards = [
    {
      label: "Active leases",
      value: stats.data?.activeLeases,
      icon: KeyRound,
      tone: "text-success",
    },
    {
      label: "Revoked today",
      value: stats.data?.revokedToday,
      icon: ShieldOff,
      tone: "text-destructive",
    },
    {
      label: "Decisions today",
      value: stats.data?.decisionsToday?.toLocaleString(),
      icon: Activity,
      tone: "text-primary-text",
    },
    {
      label: "Evidence reports exported",
      value: stats.data?.reportsExported,
      icon: FileCheck2,
      tone: "text-foreground",
    },
  ];

  return (
    <>
      <PageHeader
        title="Fleet"
        description="Robots licensed to operate inside bounded zones."
        actions={
          <Button variant="ink" onClick={() => setOpen(true)}>
            <Plus /> Grant license
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {c.label}
              <c.icon className={`size-4 ${c.tone}`} />
            </div>
            {stats.isLoading ? (
              <Skeleton className="mt-3 h-8 w-16" />
            ) : (
              <p className="mt-2 font-display text-4xl tabular-nums">{c.value ?? "—"}</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-4">
        <div className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-medium">Robots</p>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by ENS name"
                className="h-9 pl-8"
              />
            </div>
          </div>
          {robots.isLoading ? (
            <ListSkeleton rows={6} />
          ) : robots.isError ? (
            <ErrorState message={robots.error.message} onRetry={() => robots.refetch()} />
          ) : !filtered.length ? (
            <EmptyState
              title="No robots match"
              hint={q ? `Nothing matches "${q}".` : "Grant a license to add your first robot."}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">ENS name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Lease expires</TableHead>
                  <TableHead>Last decision</TableHead>
                  <TableHead>Last 0G request</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => navigate({ to: "/robots/$robotId", params: { robotId: r.id } })}
                  >
                    <TableCell className="pl-4">
                      <p className="font-mono text-sm">{r.ens}</p>
                      <p className="text-xs text-muted-foreground">{r.model}</p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-sm">{getZone(r.zoneId).name}</TableCell>
                    <TableCell>
                      {r.status === "revoked" || r.status === "unlicensed" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Countdown to={r.leaseExpiresAt} />
                      )}
                    </TableCell>
                    <TableCell>
                      <DecisionTag kind={r.lastDecision} />
                    </TableCell>
                    <TableCell>
                      {r.lastRequestId ? (
                        <CopyValue value={r.lastRequestId} head={12} tail={4} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-medium">Decisions / hour</p>
          <p className="mb-4 text-xs text-muted-foreground">Last 12h, all robots</p>
          {chart.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : chart.isError ? (
            <ErrorState message={chart.error.message} onRetry={() => chart.refetch()} />
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={chart.data ?? []}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    interval={2}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="continue" stackId="a" fill="var(--chart-1)" />
                  <Bar dataKey="slow" stackId="a" fill="var(--chart-2)" />
                  <Bar dataKey="stop" stackId="a" fill="var(--chart-3)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <GrantLicenseDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
