import { cn } from "@/lib/utils";

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect
          x="2"
          y="2"
          width="20"
          height="20"
          rx="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
        />
        <rect x="8" y="8" width="8" height="8" rx="2" fill="var(--primary)" />
      </svg>
      <span
        className={cn(
          "font-display text-xl uppercase leading-none",
          inverted && "text-ink-foreground",
        )}
      >
        Bou<span className="text-primary-text">nds</span>
      </span>
    </span>
  );
}
