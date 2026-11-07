// Writes the contract addresses from a deployment file into the workflow config, so the two cannot
// drift apart. Usage: node sync-config.mjs [path-to-deployment.json]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] ?? join(here, "..", "deployments", "sepolia.json");
const configPath = join(here, "weather-guard", "config.staging.json");

const { robotRegistrar, boundsCREConsumer } = JSON.parse(readFileSync(source, "utf8"));
if (!robotRegistrar || !boundsCREConsumer) throw new Error(`${source} lacks the contract addresses`);

const config = JSON.parse(readFileSync(configPath, "utf8"));
writeFileSync(configPath, `${JSON.stringify({ ...config, robotRegistrar, boundsCREConsumer }, null, 2)}\n`);
console.log(`Updated ${configPath} from ${source}`);
