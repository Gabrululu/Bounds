import type { Zone } from "@/services/types";

export function ZoneMap({ zone, className }: { zone: Zone; className?: string }) {
  const pad = 1;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${zone.width + pad * 2} ${zone.height + pad * 2}`}
      className={className}
      role="img"
      aria-label={`Map of ${zone.name}`}
    >
      <defs>
        <pattern id={`g-${zone.id}`} width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M1 0H0V1" fill="none" stroke="var(--grid)" strokeWidth="0.04" />
        </pattern>
      </defs>
      <rect
        x={0}
        y={0}
        width={zone.width}
        height={zone.height}
        fill={`url(#g-${zone.id})`}
        stroke="var(--primary)"
        strokeWidth="0.12"
        strokeDasharray="0.4 0.2"
        rx="0.2"
      />
      {zone.sharedArea && (
        <rect
          x={zone.sharedArea.x}
          y={zone.sharedArea.y}
          width={zone.sharedArea.w}
          height={zone.sharedArea.h}
          fill="var(--warning)"
          fillOpacity="0.15"
          stroke="var(--warning)"
          strokeWidth="0.06"
        />
      )}
      <text
        x={0}
        y={zone.height + 0.8}
        fontSize="0.55"
        fill="var(--muted-foreground)"
        fontFamily="JetBrains Mono"
      >
        {zone.width}m × {zone.height}m
      </text>
    </svg>
  );
}
