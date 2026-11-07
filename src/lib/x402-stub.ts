// wagmi's Base Account connector pulls in @coinbase/cdp-sdk, which statically imports this symbol
// from the optional peer @x402/evm. Bounds doesn't use x402, and the bundler rejects the missing
// export, so vite.config.ts aliases that package here.
export function toClientEvmSigner(): never {
  throw new Error("x402 is not available in Bounds.");
}
