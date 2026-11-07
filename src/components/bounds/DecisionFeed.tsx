import { OctagonX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Decision } from "@/services/types";
import { DecisionTag, EmptyState, Mono, TeeBadge, fmtTime, truncate } from "./shared";

export function DecisionFeed({ items, compact }: { items: Decision[]; compact?: boolean }) {
  if (!items.length)
    return (
      <EmptyState
        title="No decisions yet"
        hint="Decisions appear here as soon as the robot starts an episode."
      />
    );
  return (
    <ul className="divide-y divide-border">
      {items.map((d) =>
        d.kind === "UNREACHABLE" ? (
          <li
            key={d.id}
            className="flex items-start gap-3 border-l-2 border-destructive bg-destructive/10 px-4 py-3"
          >
            <OctagonX className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <Mono className="text-muted-foreground">{fmtTime(d.at)}</Mono>
              <p className="text-sm font-medium text-destructive">
                0G unreachable: safe-stop engaged. No decision was invented.
              </p>
            </div>
          </li>
        ) : (
          <li
            key={d.id}
            className={cn(
              "flex items-start gap-3 border-l-2 border-transparent px-4 py-3 animate-in fade-in slide-in-from-top-1",
              d.kind === "STOP" && "border-warning bg-warning/10",
            )}
          >
            <Mono className="mt-0.5 w-16 shrink-0 text-muted-foreground">{fmtTime(d.at)}</Mono>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <DecisionTag kind={d.kind} />
                {d.teeVerified && <TeeBadge />}
              </div>
              <p className="truncate text-sm">{d.reason}</p>
              {d.requestId && (
                <Mono className="block text-muted-foreground">
                  {compact ? truncate(d.requestId, 14, 6) : d.requestId}
                </Mono>
              )}
            </div>
          </li>
        ),
      )}
    </ul>
  );
}
