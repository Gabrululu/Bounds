import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tanstackStart({
      // src/server.ts is our SSR error wrapper around TanStack Start's server entry.
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    // Build-only. Produces a Node server in .output/ (run with `pnpm start`).
    ...(command === "build" ? [nitro()] : []),
    viteReact(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: [
      {
        find: /^@x402\/evm$/,
        replacement: fileURLToPath(new URL("./src/lib/x402-stub.ts", import.meta.url)),
      },
    ],
    // One copy of each, or hooks and router context break across packages.
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/react-router",
      "@tanstack/react-start",
      "wagmi",
      "viem",
    ],
  },
  server: { port: Number(process.env["PORT"]) || 8080 },
}));
