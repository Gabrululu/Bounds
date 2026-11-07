import { createFileRoute, Outlet } from "@tanstack/react-router";
import { WagmiProvider } from "wagmi";
import { AppShell } from "@/components/bounds/AppShell";
import { wagmiConfig } from "@/lib/wagmi";

export const Route = createFileRoute("/_dashboard")({
  // Wallet state and all data here exist only in the browser, so there is nothing to server-render.
  ssr: false,
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <AppShell>
        <Outlet />
      </AppShell>
    </WagmiProvider>
  );
}
