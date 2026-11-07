import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileDown, FileJson, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listRobots } from "@/services/robots";
import { buildEvidenceReport, markExported } from "@/services/evidence";
import type { EvidenceReport } from "@/services/types";
import {
  CopyValue,
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageHeader,
  StatusBadge,
  fmtDateTime,
  truncate,
} from "@/components/bounds/shared";
import { exportEvidencePdf } from "@/lib/evidence-pdf";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dashboard/evidence")({
  validateSearch: (s: Record<string, unknown>): { robot?: string } =>
    typeof s["robot"] === "string" ? { robot: s["robot"] as string } : {},
  head: () => ({
    meta: [
      { title: "Evidence report — Bounds" },
      {
        name: "description",
        content: "Prepare EU Machinery Regulation 2023/1230 evidence from on-chain and 0G records.",
      },
      { property: "og:title", content: "Evidence report — Bounds" },
      {
        property: "og:description",
        content: "Prepare EU Machinery Regulation 2023/1230 evidence from on-chain and 0G records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Evidence,
});

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportPdf(r: EvidenceReport, name: string) {
  try {
    await exportEvidencePdf(r, name);
    markExported();
    toast.success("PDF exported");
  } catch (error) {
    toast.error("PDF export failed", { description: (error as Error).message });
  }
}

function Evidence() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/evidence" });
  const robots = useQuery({ queryKey: ["robots"], queryFn: listRobots });
  const robotId = search.robot ?? robots.data?.[0]?.id;
  const [from, setFrom] = useState(() => iso(Date.now() - 30 * 86_400_000));
  const [to, setTo] = useState(() => iso(Date.now()));
  const report = useQuery({
    queryKey: ["evidence", robotId, from, to],
    queryFn: () =>
      buildEvidenceReport(robotId!, new Date(from).getTime(), new Date(to).getTime() + 86_399_000),
    enabled: !!robotId,
  });
  const robot = robots.data?.find((r) => r.id === robotId);
  const r = report.data;
  const presentCount = r?.sections.filter((s) => s.present).length ?? 0;

  return (
    <>
      <PageHeader
        title="Evidence report"
        description="Assemble evidence for EU Machinery Regulation 2023/1230 from on-chain and 0G records."
        actions={
          <>
            <Button
              variant="outline"
              disabled={!r}
              onClick={() => {
                if (!r) return;
                download(
                  `bounds-${r.ens}-${from}_${to}.json`,
                  JSON.stringify(r, null, 2),
                  "application/json",
                );
                markExported();
                toast.success("JSON exported");
              }}
            >
              <FileJson /> Export JSON
            </Button>
            <Button
              disabled={!r}
              onClick={() => {
                if (r) void exportPdf(r, `bounds-${r.ens}-${from}_${to}.pdf`);
              }}
            >
              <FileDown /> Export PDF
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-[1fr_180px_180px] gap-4 rounded-2xl border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label>Robot</Label>
          <Select value={robotId ?? ""} onValueChange={(v) => navigate({ search: { robot: v } })}>
            <SelectTrigger className="w-full font-mono">
              <SelectValue placeholder={robots.isLoading ? "Loading…" : "Select robot"} />
            </SelectTrigger>
            <SelectContent>
              {robots.data?.map((x) => (
                <SelectItem key={x.id} value={x.id} className="font-mono">
                  {x.ens}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      {robots.isError ? (
        <ErrorState message={robots.error.message} onRetry={() => robots.refetch()} />
      ) : !robots.isLoading && !robots.data?.length ? (
        <EmptyState title="No robots to report on" />
      ) : report.isLoading || !r ? (
        <div className="rounded-2xl border border-border bg-card">
          {report.isError ? (
            <ErrorState
              message={(report.error as Error).message}
              onRetry={() => report.refetch()}
            />
          ) : (
            <ListSkeleton rows={5} />
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">{r.ens}</span>
              {robot && <StatusBadge status={robot.status} />}
              <span className="text-xs text-muted-foreground">
                {from} → {to} · generated {fmtDateTime(r.generatedAt)}
              </span>
            </div>
            <span
              className={cn(
                "text-sm font-medium",
                presentCount === r.sections.length ? "text-success" : "text-warning",
              )}
            >
              {presentCount}/{r.sections.length} sections evidenced
            </span>
          </div>
          <ol className="divide-y divide-border">
            {r.sections.map((s, i) => (
              <li key={s.id} className="grid grid-cols-[32px_1fr_300px] gap-4 px-6 py-5">
                <span className="font-mono text-sm text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{s.title}</p>
                    <span className="font-mono text-[11px] text-muted-foreground">{s.article}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                  {s.note && <p className="mt-1 text-xs text-warning">{s.note}</p>}
                  {s.retention && (
                    <div className="mt-3 max-w-md">
                      <div className="mb-1 flex justify-between text-xs">
                        <span>Retention ({s.retention.requiredDays / 365} year required)</span>
                        <span className="font-mono">
                          {s.retention.coveredDays}/{s.retention.requiredDays} days
                        </span>
                      </div>
                      <Progress
                        value={(s.retention.coveredDays / s.retention.requiredDays) * 100}
                      />
                    </div>
                  )}
                  <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
                    {s.sources.length ? (
                      s.sources.map((x, j) => (
                        <li key={j} className="flex items-center gap-3 text-xs">
                          <span className="w-40 shrink-0 truncate text-muted-foreground">
                            {x.label}
                          </span>
                          {x.href ? (
                            <a
                              href={x.href}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-primary-text underline-offset-4 hover:underline"
                            >
                              {truncate(x.ref, 10, 6)}
                            </a>
                          ) : (
                            <CopyValue value={x.ref} head={12} tail={8} />
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="text-xs text-muted-foreground">
                        Missing: no records found for this period.
                      </li>
                    )}
                  </ul>
                </div>
                <div className="flex items-start justify-end">
                  {s.present ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-3 py-1 text-xs font-medium text-success">
                      <CheckCircle2 className="size-3.5" /> Evidence present
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/12 px-3 py-1 text-xs font-medium text-destructive">
                      <XCircle className="size-3.5" /> Evidence missing
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
            Supports evidence preparation. Not legal advice or certification.
          </p>
        </div>
      )}
    </>
  );
}
