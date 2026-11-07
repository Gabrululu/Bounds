import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Inbox, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Decision, RobotStatus } from "@/services/types";

export function useNow(interval = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function truncate(s: string, head = 8, tail = 6) {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function fmtTime(t: number) {
  return new Date(t).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
export function fmtDateTime(t: number) {
  return new Date(t).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs tracking-tight", className)}>{children}</span>;
}

export function CopyValue({
  value,
  head,
  tail,
  className,
}: {
  value: string;
  head?: number;
  tail?: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Mono className="text-muted-foreground">{truncate(value, head, tail)}</Mono>
      <button
        type="button"
        aria-label="Copy"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(value);
          setCopied(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 1200);
        }}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a
      href={`https://sepolia.etherscan.io/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-primary-text underline-offset-4 hover:underline"
    >
      {label ?? truncate(hash, 10, 6)}
    </a>
  );
}

const STATUS: Record<RobotStatus, { label: string; cls: string }> = {
  authorized: { label: "Authorized", cls: "bg-success/12 text-success ring-success/30" },
  expiring: { label: "Expiring", cls: "bg-warning/12 text-warning ring-warning/30" },
  expired: { label: "Expired", cls: "bg-muted text-muted-foreground ring-border" },
  revoked: { label: "Revoked", cls: "bg-destructive/12 text-destructive ring-destructive/30" },
  "safe-stop": {
    label: "Safe-stop",
    cls: "bg-destructive/20 text-destructive ring-destructive/50",
  },
  unlicensed: { label: "No license", cls: "bg-muted text-muted-foreground ring-border" },
};
export function StatusBadge({ status, className }: { status: RobotStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        s.cls,
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          status === "safe-stop" && "animate-pulse",
        )}
      />
      {s.label}
    </span>
  );
}

const DEC: Record<Decision["kind"], string> = {
  CONTINUE: "text-success",
  SLOW: "text-warning",
  STOP: "text-destructive",
  UNREACHABLE: "text-destructive",
};
export function DecisionTag({ kind }: { kind: Decision["kind"] | null }) {
  if (!kind) return <Mono className="text-muted-foreground">—</Mono>;
  return (
    <Mono className={cn("font-semibold", DEC[kind])}>
      {kind === "UNREACHABLE" ? "NO-DECISION" : kind}
    </Mono>
  );
}

export function TeeBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-text">
      <ShieldCheck className="size-3" /> TEE verified
    </span>
  );
}

export function Countdown({ to }: { to: number }) {
  const now = useNow();
  if (now === null) return <Mono className="text-muted-foreground">—</Mono>;
  const diff = to - now;
  if (diff <= 0) return <Mono className="text-muted-foreground">expired</Mono>;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return (
    <Mono className={cn(diff < 30 * 60_000 ? "text-warning" : "text-foreground")}>
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </Mono>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <Inbox className="size-8 text-muted-foreground/60" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <AlertTriangle className="size-8 text-destructive" />
      <p className="text-sm font-medium">Couldn't load data</p>
      <p className="text-xs text-muted-foreground">{message ?? "The service did not respond."}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl uppercase leading-none">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
