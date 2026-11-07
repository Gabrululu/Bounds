# Bounds

Robot licensing and compliance evidence for the EU Machinery Regulation 2023/1230. Licenses robots to bounded zones on Sepolia, records decisions from 0G Compute and checks their TEE verification, stores episodes on 0G Storage, and assembles evidence reports from those records.

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

| Variable                        | Required    | Purpose                                                                                                             |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `VITE_GUARDIAN_ADDRESS`         | Yes         | `RobotRegistrar` on Sepolia. Can also be set in `/settings`.                                                        |
| `VITE_SEPOLIA_RPC`              | Recommended | Sepolia RPC URL. Visible to users, so use a keyless or domain-restricted endpoint. Falls back to viem's public RPC. |
| `VITE_SUPABASE_URL`             | Yes         | Supabase project URL.                                                                                               |
| `VITE_SUPABASE_ANON_KEY`        | Yes         | Supabase anon key. Public by design: row level security allows reads only.                                          |
| `VITE_ENS_PARENT`               | Yes         | Parent ENS name on Sepolia, such as `acme.eth`. Can also be set in `/settings`.                                     |
| `VITE_ROBOT_LABELS`             | No          | Extra subname labels to watch. Robots with a license onchain are found from chain events.                           |
| `VITE_GUARDIAN_DEPLOY_BLOCK`    | Recommended | Chain events are scanned from here. Without it, only the last 30 days are scanned, and reports say so.              |
| `VITE_WALLETCONNECT_PROJECT_ID` | No          | Enables mobile wallets. Without it only browser wallets are offered.                                                |

### Server (Supabase secrets, `supabase/.env`)

| Variable                  | Required | Purpose                                                                                                                               |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ZEROG_API_KEY`           | Yes      | 0G Compute Router key, used by `/decide`.                                                                                             |
| `ZEROG_PRIVATE_KEY`       | Yes      | Wallet paying for 0G Storage uploads on Galileo. Use a dedicated, low-balance key.                                                    |
| `BOUNDS_API_SECRET`       | Yes      | Shared secret required in the `x-bounds-secret` header of `/decide` and `/episode/upload`. Endpoints refuse all calls if it is unset. |
| `EVIDENCE_ANCHOR_ADDRESS` | No       | `EvidenceAnchor` on Galileo. If set, `/episode/upload` anchors each root hash there.                                                  |
| `ZEROG_VISION_MODEL`      | No       | Default `0gm-1.0-35b-a3b`. Must accept images and be TEE-attested, or every decision comes back as STOP.                              |
| `ALLOWED_ORIGINS`         | No       | Comma-separated origins for CORS. Allows any origin if unset.                                                                         |

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

Uploads to 0G Storage on Galileo (chain 16602) and returns `{ rootHash, txHash, txSeq, anchorTx, stored }`. It does not wait for finality, so `/episode/verify` reports `File not finalized` until the network catches up.

### `POST /episode/verify`

Public. Body `{ "rootHash": "0x…" }`. Downloads with proof, recomputes the root from the bytes, and returns `{ ok: true }` or `{ ok: false, reason }`. Only root hashes in the `episodes` table are accepted.

## Onchain

Architecture, trust model and limits are in [ONCHAIN.md](ONCHAIN.md). The guardian is the `RobotRegistrar` contract. ABIs are in [`abi/`](abi); regenerate them and `src/abi/guardian.ts` with `forge build && node export-abi.mjs` from `contracts/`.

### Deployed addresses

Not deployed yet. After deployment, the addresses are in `deployments/sepolia.json` and `deployments/galileo.json`. Add them here, verified, with the revocation transaction.

|                                | Network    | Address or hash |
| ------------------------------ | ---------- | --------------- |
| `RobotRegistrar`               | Sepolia    | Pending         |
| `BoundsCREConsumer`            | Sepolia    | Pending         |
| `EvidenceAnchor`               | 0G Galileo | Pending         |
| Revocation by the CRE consumer | Sepolia    | Pending         |

### Deploy

Requires [Foundry](https://getfoundry.sh). Work from `contracts/`, with a wallet funded on Sepolia:

```sh
git submodule update --init --recursive
cp .env.example .env
forge test
cast wallet import bounds-deployer --interactive
```

Foundry's simulation under-estimates gas on current Sepolia, so the scripts use `--slow --skip-simulation`.

```sh
source .env
FLAGS="--rpc-url $SEPOLIA_RPC_URL --account bounds-deployer --broadcast --slow --skip-simulation"
forge script script/RegisterParent.s.sol --sig "commit()" $FLAGS
# Wait at least 60 seconds.
forge script script/RegisterParent.s.sol --sig "register()" $FLAGS
forge script script/Deploy.s.sol $FLAGS --verify
node record-deployment.mjs sepolia
forge script script/Seed.s.sol $FLAGS
```

The seed creates `robot-01` and `robot-02` as active and `robot-03` as revoked. `record-deployment.mjs` only writes the file if every transaction in the broadcast succeeded.

Then set `VITE_GUARDIAN_ADDRESS` to `robotRegistrar`, `VITE_GUARDIAN_DEPLOY_BLOCK` to `deployBlock` and `VITE_ENS_PARENT` to `ensParent`, all from `deployments/sepolia.json`.

For the evidence anchor, deploy on 0G Galileo from the `ZEROG_PRIVATE_KEY` wallet, or set `ANCHOR_OWNER` to it. Then set `EVIDENCE_ANCHOR_ADDRESS` as a Supabase secret.

```sh
forge script script/DeployAnchor.s.sol --rpc-url galileo --account bounds-deployer --broadcast --slow --skip-simulation
node record-deployment.mjs galileo
```

## Chainlink CRE

[`cre/weather-guard`](cre/weather-guard) revokes a license when live weather at the robot's zone passes a limit. Requires the [CRE CLI](https://docs.chain.link/cre) and [Bun](https://bun.sh) 1.2.21+.

**Simulation status:** the workflow compiles to WASM, passes its tests against the SDK's mocks, and its report payload revoked a license through the consumer on a Sepolia fork. `cre workflow simulate` has not been run yet, because it needs a logged-in CRE account.

```sh
cd cre
cp .env.example .env
node sync-config.mjs
cd weather-guard && bun install && bun test && cd ..
cre login
```

Dry run, then a real write. The HTTP trigger is index 1, and a low `windKmh` lets you demonstrate a revocation in calm weather. It uses the real reading, and can only make the configured limit stricter.

```sh
cre workflow simulate weather-guard --target staging-settings --non-interactive --trigger-index 0
cre workflow simulate weather-guard --target staging-settings --non-interactive --trigger-index 1 --http-payload '{"zone":"dock-1","windKmh":1}' --broadcast
```

Save the output to `cre/simulation.log`, and add the transaction hash from the log to the table above.

### Run history

The workflow does not write to Supabase. The revocations on the triggers page come from chain events. To also show run history, insert into `cre_runs` with the service role key:

| Column                         | Notes                                       |
| ------------------------------ | ------------------------------------------- |
| `workflow_id`, `workflow_name` | Stable ID and display name                  |
| `kind`                         | `weather`, `zone` or `sanctions`            |
| `description`                  | Shown on the triggers page                  |
| `run_at`                       | Defaults to now                             |
| `result`                       | `no-action`, `fired` or `error`             |
| `revocation_tx`                | Joins the run to its `LicenseRevoked` event |
| `affected_labelhash`           | Lowercase labelhash of the robot            |
| `detail`                       | Free text                                   |
