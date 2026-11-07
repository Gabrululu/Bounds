import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { FileCheck2, LayoutGrid, Moon, Settings, Sun, Workflow } from "lucide-react";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { Button } from "@/components/ui/button";
import { useServiceSync } from "./use-services";
import { Logo } from "./Logo";
import { NetworkBanner, WalletButton, useOnWrongNetwork } from "./WalletControls";

const NAV = [
  { to: "/fleet", label: "Fleet", icon: LayoutGrid },
  { to: "/triggers", label: "External triggers", icon: Workflow },
  { to: "/evidence", label: "Evidence report", icon: FileCheck2 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function NetworkPill() {
  const wrong = useOnWrongNetwork();
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs">
      <span className={`size-1.5 rounded-full ${wrong ? "bg-warning" : "bg-success"}`} />
      {wrong ? "Wrong network" : "Sepolia"}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  return (
    <RainbowKitProvider locale="en-US" theme={dark ? darkTheme() : lightTheme()}>
      <Shell dark={dark} setDark={setDark}>
        {children}
      </Shell>
    </RainbowKitProvider>
  );
}

function Shell({
  dark,
  setDark,
  children,
}: {
  dark: boolean;
  setDark: (update: (d: boolean) => boolean) => void;
  children: ReactNode;
}) {
  useServiceSync();
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
          <Link to="/" className="flex items-center gap-2">
            <Logo />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-primary"
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4 text-[11px] leading-relaxed text-muted-foreground">
          EU Machinery Regulation
          <br />
          <span className="font-mono">2023/1230</span> evidence tooling
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-end gap-3 border-b border-border bg-background/80 px-8 backdrop-blur">
          <NetworkPill />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setDark((d) => !d)}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          <WalletButton />
        </header>
        <NetworkBanner />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
