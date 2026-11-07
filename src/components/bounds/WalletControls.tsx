import type { ReactNode } from "react";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { AlertTriangle, Loader2, Wallet } from "lucide-react";
import { useAccount, useEnsName, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { sepolia } from "@/lib/wagmi";
import { truncate } from "./shared";

/** Header button: connects, then shows the wallet's ENS name (Sepolia) or its address. */
export function WalletButton() {
  const { address } = useAccount();
  const { data: ensName } = useEnsName({ address, chainId: sepolia.id });
  return (
    <ConnectButton.Custom>
      {({ account, mounted, openAccountModal, openConnectModal }) =>
        mounted && account ? (
          <Button size="sm" variant="outline" onClick={openAccountModal} className="font-mono">
            <Wallet /> {ensName ?? truncate(account.address, 6, 4)}
          </Button>
        ) : (
          <Button size="sm" variant="ink" onClick={openConnectModal}>
            <Wallet /> Connect wallet
          </Button>
        )
      }
    </ConnectButton.Custom>
  );
}

export function useOnWrongNetwork() {
  const { isConnected, chainId } = useAccount();
  return isConnected && chainId !== sepolia.id;
}

function SwitchButton({ size = "sm" }: { size?: "sm" | "default" }) {
  const { switchChain, isPending } = useSwitchChain();
  return (
    <Button
      size={size}
      variant="outline"
      disabled={isPending}
      onClick={() => switchChain({ chainId: sepolia.id })}
    >
      {isPending ? <Loader2 className="animate-spin" /> : null} Switch to Sepolia
    </Button>
  );
}

export function NetworkBanner() {
  if (!useOnWrongNetwork()) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 border-b border-warning/40 bg-warning/10 px-8 py-2.5 text-sm"
    >
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-warning" /> Your wallet is on the wrong network.
        Bounds runs on Sepolia.
      </span>
      <SwitchButton />
    </div>
  );
}

/** Connect, then switch, then act: shows the next required step until the wallet is ready. */
export function WalletGate({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const wrongNetwork = useOnWrongNetwork();
  if (!isConnected) {
    return (
      <Button type="button" variant="ink" onClick={openConnectModal}>
        <Wallet /> Connect wallet
      </Button>
    );
  }
  if (wrongNetwork) return <SwitchButton size="default" />;
  return <>{children}</>;
}
