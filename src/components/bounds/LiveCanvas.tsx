import { useEffect, useRef } from "react";
import type { Zone } from "@/services/types";

/** Top-down 2D view of the licensed zone. No position feed exists yet, so no robot is drawn. */
export function LiveCanvas({ zone, active }: { zone: Zone; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const col = (n: string) => css.getPropertyValue(n).trim();

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pad = 24;
      const s = Math.min((w - pad * 2) / zone.width, (h - pad * 2) / zone.height);
      const ox = (w - zone.width * s) / 2;
      const oy = (h - zone.height * s) / 2;
      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = col("--grid");
      ctx.lineWidth = 1;
      for (let i = 0; i <= zone.width; i++) {
        ctx.beginPath();
        ctx.moveTo(ox + i * s, oy);
        ctx.lineTo(ox + i * s, oy + zone.height * s);
        ctx.stroke();
      }
      for (let j = 0; j <= zone.height; j++) {
        ctx.beginPath();
        ctx.moveTo(ox, oy + j * s);
        ctx.lineTo(ox + zone.width * s, oy + j * s);
        ctx.stroke();
      }

      if (zone.sharedArea) {
        const a = zone.sharedArea;
        ctx.fillStyle = col("--warning");
        ctx.globalAlpha = 0.14;
        ctx.fillRect(ox + a.x * s, oy + a.y * s, a.w * s, a.h * s);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col("--warning");
        ctx.strokeRect(ox + a.x * s, oy + a.y * s, a.w * s, a.h * s);
        ctx.fillStyle = col("--warning");
        ctx.font = "10px JetBrains Mono";
        ctx.fillText("SHARED AREA", ox + a.x * s + 6, oy + a.y * s + 14);
      }

      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = active ? col("--primary") : col("--destructive");
      ctx.lineWidth = 2;
      ctx.strokeRect(ox, oy, zone.width * s, zone.height * s);
      ctx.setLineDash([]);

      ctx.fillStyle = col("--muted-foreground");
      ctx.font = "11px JetBrains Mono";
      ctx.fillText(
        `${zone.width}m × ${zone.height}m · position telemetry not connected`,
        ox,
        oy + zone.height * s + 16,
      );
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(c);
    return () => observer.disconnect();
  }, [zone, active]);

  return <canvas ref={ref} className="h-full w-full" />;
}
