// Writes deployments/<network>.json from Foundry's broadcast receipts, so a file only ever lists
// contracts from transactions that succeeded on chain.
// Usage: node record-deployment.mjs sepolia [--out path]    node record-deployment.mjs galileo
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const network = process.argv[2];
const NETWORKS = {
  sepolia: { chainId: 11155111, script: "Deploy.s.sol" },
  galileo: { chainId: 16602, script: "DeployAnchor.s.sol" },
};
const target = NETWORKS[network];
if (!target) throw new Error(`Usage: record-deployment.mjs ${Object.keys(NETWORKS).join("|")}`);
const outFlag = process.argv.indexOf("--out");
const out = outFlag > 0 ? process.argv[outFlag + 1] : join(here, "..", "deployments", `${network}.json`);

const run = join(here, "broadcast", target.script, String(target.chainId), "run-latest.json");
if (!existsSync(run)) throw new Error(`No broadcast found at ${run}. Run the deploy script first.`);
const { transactions, receipts } = JSON.parse(readFileSync(run, "utf8"));

const failed = receipts.filter((r) => Number(r.status) !== 1);
if (failed.length || receipts.length !== transactions.length) {
  throw new Error(`Deployment incomplete: ${failed.length} failed, ${receipts.length}/${transactions.length} mined.`);
}

const addressOf = (name) => {
  const tx = transactions.find((t) => t.transactionType === "CREATE" && t.contractName === name);
  if (!tx) throw new Error(`${name} not found in broadcast`);
  return tx.contractAddress;
};

let deployment;
if (network === "sepolia") {
  const registrarTx = transactions.find((t) => t.contractName === "RobotRegistrar");
  const [registry, , , dnsParent] = registrarTx.arguments;
  const firstLabel = Buffer.from(dnsParent.slice(4), "hex");
  const label = firstLabel.subarray(0, parseInt(dnsParent.slice(2, 4), 16)).toString();
  deployment = {
    chainId: target.chainId,
    deployBlock: Number(receipts[0].blockNumber),
    ensParent: `${label}.eth`,
    userRegistry: registry,
    robotRegistrar: addressOf("RobotRegistrar"),
    boundsCREConsumer: addressOf("BoundsCREConsumer"),
    creForwarder: transactions.find((t) => t.contractName === "BoundsCREConsumer").arguments[1],
  };
} else {
  deployment = { chainId: target.chainId, evidenceAnchor: addressOf("EvidenceAnchor") };
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(deployment, null, 2)}\n`);
console.log(`Wrote ${out}`);
console.log(deployment);
