## North star

Robot fleet operators can prove their machines stayed inside authorized, stoppable limits. Metric: evidence reports exported per month.

## Architecture

- All app data goes through typed async functions in src/services (robots, decisions, evidence). Writes and guardian events call emit() so the UI refetches. Why: screens stay independent of chain and Supabase details.
- src/services/guardian.ts is the only module that knows the guardian ABI shape. Why: src/abi/guardian.ts is a placeholder until the real ABI lands.
- Robots are keyed by labelhash, never ENS token ID. Why: token IDs can regenerate.
- Marketing landing lives at / outside the dashboard; all dashboard pages are children of the pathless \_dashboard layout (AppShell), which has ssr: false. Why: wallet state and all data exist only in the browser.
- Secrets live only in Supabase Edge Functions. Logic that needs tests goes in supabase/functions/\_shared with no Deno or npm imports.

## Safety rules

- Never fabricate data. A missing source reads as missing, a failed source as failed.
- /decide returns the unreachable STOP on any failure, and never lets a response that failed TEE verification move a robot.

## Tooling

- Package manager is pnpm. `pnpm typecheck`, `pnpm test`, `pnpm build`.
- deepmerge 4.3.1 has no patched release, so `patches/deepmerge@4.3.1.patch` blocks `__proto__` keys and `pnpm.auditConfig` ignores GHSA-gcqx-w48m-w2h4. Why: pnpm audit only compares versions. Remove both when a fixed release ships.
- Overrides force zod 4 onto wallet libraries that declare zod 3. Why: the memory-exhaustion fix exists only in 4.6.6+. Recheck wallet connection after upgrading them.
