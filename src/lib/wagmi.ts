import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { SEPOLIA_RPC, WALLETCONNECT_PROJECT_ID } from "@/services/config";

// Without a WalletConnect project ID only browser wallets are offered. The placeholder satisfies
// RainbowKit's required argument and is never sent anywhere by the injected connector.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: WALLETCONNECT_PROJECT_ID
        ? [injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet]
        : [injectedWallet],
    },
  ],
  { appName: "Bounds", projectId: WALLETCONNECT_PROJECT_ID || "not-configured" },
);

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors,
  transports: { [sepolia.id]: http(SEPOLIA_RPC) },
});

export { sepolia };
