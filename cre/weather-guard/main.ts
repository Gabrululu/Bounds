// Revokes a robot's license when the live weather at its zone passes a limit.
//
// 1. Read each robot's license from RobotRegistrar. Its zone comes from the chain, not from config.
// 2. Fetch current weather for those zones from Open-Meteo, with consensus across nodes.
// 3. For each active robot in an unsafe zone, send a signed report to BoundsCREConsumer.
//
// If the weather API fails the run fails and nothing is revoked: a missing reading is not evidence
// of danger. Robots stay protected by their short leases and safe-stop.
import {
  bytesToHex,
  ConsensusAggregationByFields,
  CronCapability,
  decodeJson,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  handler,
  hexToBase64,
  HTTPCapability,
  HTTPClient,
  type HTTPPayload,
  type HTTPSendRequester,
  LATEST_BLOCK_NUMBER,
  median,
  Runner,
  type Runtime,
  TxStatus,
} from "@chainlink/cre-sdk"
import { EVM_PB } from "@chainlink/cre-sdk/pb"
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address, zeroAddress } from "viem"
import { z } from "zod"

import {
  encodeRevocation,
  labelhash,
  parseWeather,
  stricterLimits,
  unsafeReason,
  type WeatherLimits,
  type WeatherReading,
  weatherUrl,
  type Zone,
  zoneId,
} from "./logic"

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

export const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  robotRegistrar: address,
  boundsCREConsumer: address,
  writeGasLimit: z.string(),
  weatherApiUrl: z.url(),
  limits: z.object({ windKmh: z.number().positive(), rainMmPerHour: z.number().positive() }),
  // Keeps one run inside CRE's quota of 15 EVM reads and 15 HTTP calls per execution.
  robots: z.array(z.string().min(1)).min(1).max(10),
  zones: z.array(z.object({ name: z.string(), latitude: z.number(), longitude: z.number() })).min(1).max(10),
})
export type Config = z.infer<typeof configSchema>

const httpPayloadSchema = z.object({
  zone: z.string().optional(),
  windKmh: z.number().positive().optional(),
  rainMmPerHour: z.number().positive().optional(),
})

const REGISTRAR_ABI = parseAbi([
  "function getLicense(bytes32 labelhash) view returns (bytes32 zoneId, uint64 expiry, uint256 permissions, bool revoked, address robot, address resolver)",
])

const evmClientFor = (config: Config): EVMClient => {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName })
  if (!network) throw new Error(`Unknown chain: ${config.chainSelectorName}`)
  return new EVMClient(network.chainSelector.selector)
}

/** Robots with a live license, grouped by the zone recorded onchain. */
const activeRobotsByZone = (runtime: Runtime<Config>, evm: EVMClient): Map<string, string[]> => {
  const { robots, zones, robotRegistrar } = runtime.config
  const byZone = new Map<string, string[]>()
  for (const label of robots) {
    const call = evm
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: robotRegistrar as Address,
          data: encodeFunctionData({ abi: REGISTRAR_ABI, functionName: "getLicense", args: [labelhash(label)] }),
        }),
        blockNumber: LATEST_BLOCK_NUMBER,
      })
      .result()
    const [zone, , permissions, revoked] = decodeFunctionResult({
      abi: REGISTRAR_ABI,
      functionName: "getLicense",
      data: bytesToHex(call.data),
    })
    // The registrar reports 0 permissions once a lease has expired or was revoked.
    if (revoked || permissions === 0n) {
      runtime.log(`${label}: no active license, skipped`)
      continue
    }
    const known = zones.find((z) => zoneId(z.name) === zone)
    if (!known) {
      runtime.log(`${label}: zone ${zone} has no coordinates in config, skipped`)
      continue
    }
    byZone.set(known.name, [...(byZone.get(known.name) ?? []), label])
  }
  return byZone
}

const fetchWeather = (requester: HTTPSendRequester, url: string): WeatherReading => {
  const response = requester.sendRequest({ url, method: "GET" }).result()
  if (response.statusCode !== 200) throw new Error(`Weather API returned ${response.statusCode}`)
  return parseWeather(new TextDecoder().decode(response.body))
}

const revoke = (runtime: Runtime<Config>, evm: EVMClient, label: string, reason: string): string => {
  const report = runtime
    .report({
      encodedPayload: hexToBase64(encodeRevocation(label, reason)),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result()
  const write = evm
    .writeReport(runtime, {
      receiver: runtime.config.boundsCREConsumer,
      report,
      gasConfig: { gasLimit: runtime.config.writeGasLimit },
    })
    .result()
  const txHash = bytesToHex(write.txHash ?? new Uint8Array(32))
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Revocation of ${label} failed: ${write.errorMessage ?? write.txStatus}`)
  }
  // The forwarder transaction can succeed while onReport reverts inside it.
  if (write.receiverContractExecutionStatus === EVM_PB.ReceiverContractExecutionStatus.REVERTED) {
    throw new Error(`Revocation of ${label} reverted in the consumer, tx ${txHash}`)
  }
  runtime.log(`${label}: revoked (${reason}), tx ${txHash}`)
  return txHash
}

const evaluate = (runtime: Runtime<Config>, limits: WeatherLimits, onlyZone?: string): string => {
  const { zones, weatherApiUrl } = runtime.config
  const evm = evmClientFor(runtime.config)
  const http = new HTTPClient()
  const revoked: string[] = []

  for (const [zoneName, robots] of activeRobotsByZone(runtime, evm)) {
    if (onlyZone && onlyZone !== zoneName) continue
    const zone = zones.find((z) => z.name === zoneName) as Zone
    const reading = http
      .sendRequest(
        runtime,
        fetchWeather,
        ConsensusAggregationByFields<WeatherReading>({ windKmh: median, rainMmPerHour: median }),
      )(weatherUrl(weatherApiUrl, zone))
      .result()
    const reason = unsafeReason(reading, limits)
    runtime.log(
      `${zoneName}: wind ${reading.windKmh} km/h (limit ${limits.windKmh}), ` +
        `rain ${reading.rainMmPerHour} mm/h (limit ${limits.rainMmPerHour}) -> ${reason ?? "safe"}`,
    )
    if (!reason) continue
    for (const label of robots) {
      revoke(runtime, evm, label, reason)
      revoked.push(label)
    }
  }
  return revoked.length ? `Revoked: ${revoked.join(", ")}` : "No revocations"
}

export const onCron = (runtime: Runtime<Config>): string => evaluate(runtime, runtime.config.limits)

/** Lets an operator re-check now, for one zone or all, with limits at least as strict as config. */
export const onHttp = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const request = httpPayloadSchema.parse(decodeJson(payload.input))
  return evaluate(runtime, stricterLimits(runtime.config.limits, request), request.zone)
}

export const initWorkflow = (config: Config) => [
  handler(new CronCapability().trigger({ schedule: config.schedule }), onCron),
  // Empty authorizedKeys only works in simulation. A deployed workflow must set them.
  handler(new HTTPCapability().trigger({}), onHttp),
]

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
