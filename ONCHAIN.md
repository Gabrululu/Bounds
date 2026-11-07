# Bounds onchain

How licenses, revocation and evidence work onchain, who can do what, and what this does not guarantee.

Bounds supports evidence preparation for EU Machinery Regulation 2023/1230. It does not certify compliance and is not legal advice.

## Architecture

```
Operator wallet ──grantLicense / revokeLicense──▶ RobotRegistrar ──▶ ENSv2 UserRegistry  (subname, expiry, roles)
                                                       ▲   │
Open-Meteo ──▶ CRE workflow ──report──▶ Forwarder ──▶ BoundsCREConsumer
                                                           │
                                                           └──▶ one PermissionedResolver per robot (text records)

/episode function ──upload──▶ 0G Storage
                  └─anchorEpisode──▶ EvidenceAnchor (0G Galileo)
```

| Contract                     | Chain      | Role                                                                                 |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `RobotRegistrar`             | Sepolia    | The guardian. Grants and revokes licenses, and is the app's source of truth.         |
| `BoundsCREConsumer`          | Sepolia    | Accepts reports from the Chainlink Forwarder and calls `revokeFromCRE`.              |
| ENSv2 `UserRegistry`         | Sepolia    | Holds the subnames under the parent name. Deployed from the official implementation. |
| ENSv2 `PermissionedResolver` | Sepolia    | One instance per robot, deployed from the official implementation.                   |
| `EvidenceAnchor`             | 0G Galileo | Records each episode's 0G Storage root hash and the hash of its decisions.           |

Addresses are in [`deployments/`](deployments) and ABIs in [`abi/`](abi).

### What a license is

- **Name:** `robot-01.<parent>.eth`, a real ENSv2 subname that the Universal Resolver resolves.
- **Lease:** the registry's own expiry. When it passes, the name and all its roles stop being valid, with no transaction.
- **Permissions:** Enhanced Access Control roles on the name, held by the robot's address. The custom roles are `ROLE_MOVE` (`1 << 40`), `ROLE_MANIPULATE` (`1 << 44`) and `ROLE_ENTER_SHARED_AREA` (`1 << 48`).
- **Records:** hashes and state only: `addr`, `bounds.status`, `bounds.statusHash`, `bounds.zoneHash`, `bounds.expiry`, `bounds.model`, `agent-context`.

Names are not emancipated: the registrar keeps the admin roles, so the operator can always revoke. Licenses are indexed by labelhash, never by ENS token ID, because token IDs regenerate each time roles change (`TokenRegenerated`).

### Revocation

`revokeLicense` (operator) and `revokeFromCRE` (consumer) share one path:

1. Remove the robot's roles. If that fails, for example because a robot contract rejects the token callback, unregister the name instead, so a robot cannot block its own revocation.
2. Set `bounds.status` to `revoked`.
3. Emit `LicenseRevoked(labelhash, reasonCode, source, caller, timestamp)`.

### The CRE workflow

[`cre/weather-guard`](cre/weather-guard) runs on a cron trigger, or on an HTTP trigger for an immediate re-check:

1. Reads each robot's license from the registrar. The robot's zone comes from the chain.
2. Fetches current wind and rain for those zones from Open-Meteo, with median consensus across nodes.
3. For each active robot in a zone over the limit, sends `(labelhash, reasonCode, source)` to the consumer.

An HTTP caller can only make the limits stricter. If the weather API fails, the run fails and nothing is revoked. The workflow also checks `receiverContractExecutionStatus`, because a Forwarder transaction can succeed while `onReport` reverts inside it.

## Trust model

These are managed names. The operator is in control of the fleet, and robots do not own their licenses in any meaningful sense.

| Actor                                                      | Can                                            | Cannot                                                         |
| ---------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| Operator (owner of `RobotRegistrar`, one EOA)              | Grant, revoke, set records, change the revoker | Upgrade the registry or resolvers: nobody holds `ROLE_UPGRADE` |
| `BoundsCREConsumer`                                        | Revoke                                         | Grant, or change any record outside revocation                 |
| CRE workflow                                               | Revoke through the consumer                    | Grant                                                          |
| Robot                                                      | Write its own `agent-endpoint[mcp]` record     | Write any other record, or touch another robot                 |
| Anyone                                                     | Read everything                                | Write                                                          |
| Owner of `EvidenceAnchor` (the `ZEROG_PRIVATE_KEY` wallet) | Anchor a root hash once                        | Change or delete an anchor                                     |

A compromised operator key can revoke or re-license the whole fleet. Use a multisig for anything beyond a demo.

## Limits

**Revocation is cooperative.** It changes state onchain. It does not stop a motor. A robot has to read that state and obey it, and an offline robot sees nothing. The protection for an offline robot is a short lease and a safe-stop when it cannot confirm its license. Keep leases short in production; the demo seed uses 30 days only so that it stays up for judging.

**The mock forwarder has no access control.** `CRE_FORWARDER` defaults to Chainlink's `MockKeystoneForwarder`, the one `cre workflow simulate` writes through. It does not verify signatures, so anyone can route a report through it and revoke a license while the consumer points at it. A fake report can only revoke, never grant. For production, set the consumer to the real `KeystoneForwarder` and call `setExpectedWorkflow`. The mock provides no workflow metadata, so that check must stay unset during simulation.

**Reports have no timestamp.** A delayed report could revoke a license that was granted again after the report was created. The report layout is `(labelhash, reasonCode, source)`, as specified. Adding an issue time and comparing it with the grant would close this.

**Weather failure leaves licenses as they are.** No reading is not treated as danger, so an outage of Open-Meteo means no automatic revocation. Leases and operator revocation still apply.

**One weather source, no sanctions feed.** Sanctions screening was optional and is not implemented. `cre_runs` is not filled by this workflow, so the run history on the triggers page stays empty unless a script inserts into it. Revocations themselves are read from chain events.

**One resolver per robot costs gas.** `grantLicense` uses about 4.3M gas, which is fine on Sepolia and expensive on mainnet.

**ENSIP-25 needs a real registry entry.** `setAgentRecord` can write `agent-registration[<registry>][<agentId>]`, but the seed does not: writing it without a real agent registration would be false.

## Measured gas

Measured against real Sepolia state on a local fork.

| Operation                  | Gas         |
| -------------------------- | ----------- |
| Full `Deploy` script       | about 21.6M |
| `grantLicense` (new robot) | about 4.29M |
| `revokeLicense`            | about 453k  |
| `onReport` to revocation   | about 465k  |

Set the workflow's `writeGasLimit` above the last figure. The config uses 700000.

## Spike results

| Question                                                                | Result                                                   | Evidence                                                                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Subname under a Sepolia parent, with expiry and EAC roles, then revoke? | Yes                                                      | Fork tests against real Sepolia contracts, plus a scripted rehearsal on a fork                        |
| Are resolver roles per name or per resolver?                            | Per resolver instance, with optional scoping by argument | ENS docs. Per-robot isolation therefore needs one resolver per robot, tested                          |
| Is Sepolia in CRE's supported networks, with a Forwarder?               | Yes                                                      | Chain selector `ethereum-testnet-sepolia`; forwarder addresses below, code confirmed with `cast code` |
| Does `cre workflow simulate` run HTTP plus EVM write against Sepolia?   | **See the status line in the README**                    | Needs `cre login`                                                                                     |

| CRE Forwarder on Sepolia             | Address                                      |
| ------------------------------------ | -------------------------------------------- |
| `MockKeystoneForwarder` (simulation) | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| `KeystoneForwarder` (production)     | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` |

### Where sources disagreed

- **CRE login:** the docs say all CLI commands need a login, while one table lists simulation auth as not required. CLI v1.39.0 refuses `workflow simulate` without `cre login` or `CRE_API_KEY`.
- **Universal Resolver:** the ENS docs list `0x24E1…2D72`, while viem's default for Sepolia is `0xeEeE…eEeE`. Both resolved these names on the fork. The app uses viem's default.
- **Gas estimates:** Foundry 1.8.5 under-estimates against current Sepolia, for example about 48k simulated against 128,547 real for `commit`. Deployment scripts therefore run with `--slow --skip-simulation`.
- **ENSv2 dependency:** `forge install ensdomains/contracts-v2` fails on Windows because of a file name in a nested submodule. The repo uses minimal local interfaces in `IENSv2.sol`, which the fork tests validate against the deployed contracts.

## Sources

- ENSv2 contracts: `ensdomains/contracts-v2` at commit `07e55a056f5b6a9c90119f501bdd05714e67dddd`, and https://docs.ens.domains
- ENSIP-25 and ENSIP-26 for agent records
- Chainlink CRE: https://docs.chain.link/cre
