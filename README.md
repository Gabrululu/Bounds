# Bounds

Robot licensing and compliance evidence for the EU Machinery Regulation 2023/1230. Licenses robots to bounded zones on Sepolia, gates motion with TEE-verified decisions from 0G Compute, stores episodes on 0G Storage, and assembles evidence reports from those records.

Supports evidence preparation. Not legal advice or certification.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

The app runs on http://localhost:8080. Other commands: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm start` (runs the Node server built in `.output/`).

## Stack

TanStack Start, React, Tailwind CSS, viem, wagmi, RainbowKit, Supabase (Postgres, Realtime, Edge Functions), 0G Compute, 0G Storage.

## Environment variables

### Browser (`.env.local`)

Every `VITE_` value is bundled into the client. None may be a secret.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_GUARDIAN_ADDRESS` | Yes | Guardian contract on Sepolia. Can also be set in `/settings`. |
| `VITE_SEPOLIA_RPC` | Recommended | Sepolia RPC URL. Visible to users, so use a keyless or domain-restricted endpoint. Falls back to viem's public RPC. |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon key. Public by design: row level security allows reads only. |
| `VITE_ENS_PARENT` | Yes | Parent ENS name on Sepolia, such as `acme.eth`. Can also be set in `/settings`. |
| `VITE_ROBOT_LABELS` | No | Comma-separated subname labels. Can also be set in `/settings`. |
| `VITE_GUARDIAN_DEPLOY_BLOCK` | Recommended | Chain events are scanned from here. Without it, only the last 30 days are scanned, and reports say so. |
| `VITE_REGISTRAR_ADDRESS` | No | If set, `grantLicense` is sent here instead of the guardian. |
| `VITE_WALLETCONNECT_PROJECT_ID` | No | Enables mobile wallets. Without it only browser wallets are offered. |

### Server (Supabase secrets, `supabase/.env`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `ZEROG_API_KEY` | Yes | 0G Compute Router key, used by `/decide`. |
| `ZEROG_PRIVATE_KEY` | Yes | Wallet paying for 0G Storage uploads on Galileo. Use a dedicated, low-balance key. |
| `BOUNDS_API_SECRET` | Yes | Shared secret required in the `x-bounds-secret` header of `/decide` and `/episode/upload`. Endpoints refuse all calls if it is unset. |
| `ZEROG_VISION_MODEL` | No | Default `0gm-1.0-35b-a3b`. Must accept images and be TEE-attested, or every decision comes back as STOP. |
| `ALLOWED_ORIGINS` | No | Comma-separated origins for CORS. Allows any origin if unset. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions by Supabase.

## Supabase setup

```sh
pnpm dlx supabase link --project-ref <ref>
pnpm dlx supabase db push
pnpm dlx supabase secrets set --env-file supabase/.env
pnpm dlx supabase functions deploy decide
pnpm dlx supabase functions deploy episode
```

Tables: `decisions`, `episodes`, `cre_runs`. All are publicly readable through the anon key, so they must not hold sensitive data. Frames are never stored.

## Server API

Base URL: `https://<ref>.supabase.co/functions/v1`.

### `POST /decide`

Header `x-bounds-secret`. Body `{ "robotLabel": "robot-07", "frame": "<base64 jpeg, png or webp>" }`, 8 MB maximum.

Returns `{ action: "CONTINUE"|"SLOW"|"STOP", reason, requestId, teeVerified }`. Every decision is stored in `decisions`.

- If the router fails, times out (20s) or returns anything that isn't a valid decision, it returns `{ action: "STOP", unreachable: true }`.
- If the response fails TEE verification, it returns `STOP` with `teeVerified: false`, because 0G's docs say to treat those responses as untrusted.
- A non-200 status (bad input or bad secret) carries no decision. Clients must treat it as STOP.

### `POST /episode/upload`

Header `x-bounds-secret`. Body, 1 MB maximum:

```json
{
  "robotLabel": "robot-07",
  "startedAt": "2026-11-06T10:00:00Z",
  "durationSec": 3600,
  "decisions": [],
  "requestIds": [],
  "permissionSnapshot": {}
}
```

Uploads to 0G Storage on Galileo (chain 16602) and returns `{ rootHash, txHash, txSeq, stored }`. It does not wait for finality, so `/episode/verify` reports `File not finalized` until the network catches up.

### `POST /episode/verify`

Public. Body `{ "rootHash": "0x…" }`. Downloads with proof, recomputes the root from the bytes, and returns `{ ok: true }` or `{ ok: false, reason }`. Only root hashes in the `episodes` table are accepted.

## On-chain contract

`src/abi/guardian.ts` is a placeholder until the real ABI is added. If it differs, only `src/services/guardian.ts` needs to change. The app expects:

- `grantLicense(label, zoneId, expiry, rolesBitmap)` and `revokeLicense(label)`
- `getLicense(labelhash)` returning zone, expiry, roles and revoked state
- Events `LicenseGranted` and `LicenseRevoked(label, reason, source)`

Role bits: `move` = 1, `manipulate` = 2, `enter-shared-area` = 4. `zoneId` is the keccak256 of the zone ID string.

ENS text records read from each subname: `bounds.statusHash`, `bounds.expiry` (Unix seconds), `bounds.model`. Only hashes, state and expiry belong in text records. If the ENS and guardian expiries disagree, the earlier one wins.

## Chainlink CRE

Workflows run outside this app. Your script inserts into `cre_runs` with the service role key:

| Column | Notes |
| --- | --- |
| `workflow_id`, `workflow_name` | Stable ID and display name |
| `kind` | `weather`, `zone` or `sanctions` |
| `description` | Shown on the triggers page |
| `run_at` | Defaults to now |
| `result` | `no-action`, `fired` or `error` |
| `revocation_tx` | Joins the run to its `LicenseRevoked` event |
| `affected_labelhash` | Lowercase labelhash of the robot |
| `detail` | Free text |
