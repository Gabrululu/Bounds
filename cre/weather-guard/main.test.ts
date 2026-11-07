import { describe, expect } from "bun:test"
import { bytesToHex, hexToBase64 } from "@chainlink/cre-sdk"
import { EVM_PB } from "@chainlink/cre-sdk/pb"
import { EvmMock, HttpActionsMock, newTestRuntime, test } from "@chainlink/cre-sdk/test"
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, parseAbi, parseAbiParameters, type Hex } from "viem"

import { labelhash, parseWeather, REASON_RAIN, REASON_WIND, stricterLimits, toBytes32Text, unsafeReason, zoneId } from "./logic"
import { type Config, onCron, onHttp } from "./main"

const SEPOLIA = 16015286601757825753n
const zero = `0x${"00".repeat(20)}` as Hex

const config: Config = {
  schedule: "0 */15 * * * *",
  chainSelectorName: "ethereum-testnet-sepolia",
  robotRegistrar: `0x${"11".repeat(20)}`,
  boundsCREConsumer: `0x${"22".repeat(20)}`,
  writeGasLimit: "700000",
  weatherApiUrl: "https://weather.test/v1/forecast",
  limits: { windKmh: 50, rainMmPerHour: 10 },
  robots: ["robot-01", "robot-02", "robot-03"],
  zones: [
    { name: "cell-a", latitude: 1, longitude: 2 },
    { name: "dock-1", latitude: 3, longitude: 4 },
    { name: "wh-3", latitude: 5, longitude: 6 },
  ],
}

type LicenseStub = { zone: string; permissions: bigint; revoked: boolean }

const registrarAbi = parseAbi(["function getLicense(bytes32 labelhash)"])
const licenseAbi = parseAbiParameters("bytes32, uint64, uint256, bool, address, address")

/** Registers mocks for the chain, the weather API and consensus, and records what gets written. */
const setup = (
  licenses: Record<string, LicenseStub>,
  weather: { wind: number; rain: number } | { status: number },
  receiverStatus = EVM_PB.ReceiverContractExecutionStatus.SUCCESS,
) => {
  const byHash = new Map(Object.entries(licenses).map(([label, l]) => [labelhash(label), l]))
  const evm = EvmMock.testInstance(SEPOLIA)
  const reports: { receiver: string; payload: readonly [Hex, Hex, Hex] }[] = []
  const urls: string[] = []

  evm.callContract = (input) => {
    const { args } = decodeFunctionData({ abi: registrarAbi, data: bytesToHex(input.call!.data) })
    const license = byHash.get(args[0])
    const data = encodeAbiParameters(licenseAbi, [
      license ? zoneId(license.zone) : `0x${"00".repeat(32)}`,
      1893456000n,
      license?.permissions ?? 0n,
      license?.revoked ?? false,
      zero,
      zero,
    ])
    return { data: hexToBase64(data) }
  }
  evm.writeReport = (input) => {
    const raw = bytesToHex(input.report!.rawReport)
    // The metadata header that runtime.report puts first is 109 bytes.
    const payload = decodeAbiParameters(
      parseAbiParameters("bytes32, bytes32, bytes32"),
      `0x${raw.slice(2 + 109 * 2)}`,
    ) as readonly [Hex, Hex, Hex]
    reports.push({ receiver: bytesToHex(input.receiver), payload })
    return {
      txStatus: EVM_PB.TxStatus.SUCCESS,
      receiverContractExecutionStatus: receiverStatus,
      txHash: hexToBase64(`0x${"ab".repeat(32)}`),
    } as never
  }

  HttpActionsMock.testInstance().sendRequest = (input) => {
    urls.push(input.url)
    if ("status" in weather) return { statusCode: weather.status, body: "" }
    const body = JSON.stringify({ current: { wind_speed_10m: weather.wind, precipitation: weather.rain } })
    return { statusCode: 200, body: Buffer.from(body).toString("base64") }
  }

  const runtime = newTestRuntime()
  runtime.config = config
  return { runtime: runtime as never as Parameters<typeof onCron>[0] & { getLogs(): string[] }, reports, urls }
}

const active = (zone: string): LicenseStub => ({ zone, permissions: 3n, revoked: false })

describe("logic", () => {
  test("wind wins over rain and limits are inclusive", () => {
    const limits = config.limits
    expect(unsafeReason({ windKmh: 50, rainMmPerHour: 99 }, limits)).toBe(REASON_WIND)
    expect(unsafeReason({ windKmh: 49.9, rainMmPerHour: 10 }, limits)).toBe(REASON_RAIN)
    expect(unsafeReason({ windKmh: 49.9, rainMmPerHour: 9.9 }, limits)).toBeNull()
  })

  test("an HTTP caller can tighten limits but never relax them", () => {
    expect(stricterLimits(config.limits, { windKmh: 5 }).windKmh).toBe(5)
    expect(stricterLimits(config.limits, { windKmh: 500, rainMmPerHour: 500 })).toEqual(config.limits)
  })

  test("a weather response without readings throws instead of passing as safe", () => {
    expect(() => parseWeather("{}")).toThrow("wind")
    expect(() => parseWeather('{"current":{"wind_speed_10m":3}}')).toThrow("precipitation")
    expect(() => parseWeather('{"current":{"wind_speed_10m":"3","precipitation":0}}')).toThrow("wind")
  })
})

describe("workflow", () => {
  test("revokes only the active robots in the unsafe zone", () => {
    const { runtime, reports } = setup(
      {
        "robot-01": active("dock-1"),
        "robot-02": { zone: "dock-1", permissions: 0n, revoked: false },
        "robot-03": { zone: "dock-1", permissions: 1n, revoked: true },
      },
      { wind: 80, rain: 0 },
    )
    expect(onCron(runtime)).toBe("Revoked: robot-01")
    expect(reports).toHaveLength(1)
    expect(reports[0].payload).toEqual([labelhash("robot-01"), toBytes32Text(REASON_WIND), toBytes32Text("open-meteo")])
    expect(reports[0].receiver).toBe(config.boundsCREConsumer)
  })

  test("leaves robots alone when the weather is safe", () => {
    const { runtime, reports } = setup({ "robot-01": active("cell-a") }, { wind: 10, rain: 0 })
    expect(onCron(runtime)).toBe("No revocations")
    expect(reports).toHaveLength(0)
  })

  test("uses the zone read from chain to pick the coordinates", () => {
    const { runtime, urls } = setup({ "robot-01": active("wh-3") }, { wind: 1, rain: 0 })
    onCron(runtime)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("latitude=5&longitude=6")
  })

  test("skips a robot whose onchain zone has no coordinates", () => {
    const { runtime, urls, reports } = setup({ "robot-01": active("unknown-zone") }, { wind: 99, rain: 99 })
    expect(onCron(runtime)).toBe("No revocations")
    expect(urls).toHaveLength(0)
    expect(reports).toHaveLength(0)
  })

  test("revokes nothing when the weather API fails", () => {
    const { runtime, reports } = setup({ "robot-01": active("cell-a") }, { status: 503 })
    expect(() => onCron(runtime)).toThrow()
    expect(reports).toHaveLength(0)
  })

  test("fails when the consumer reverts inside a successful forwarder transaction", () => {
    const { runtime } = setup(
      { "robot-01": active("cell-a") },
      { wind: 99, rain: 0 },
      EVM_PB.ReceiverContractExecutionStatus.REVERTED,
    )
    expect(() => onCron(runtime)).toThrow("reverted in the consumer")
  })

  test("HTTP trigger can target one zone with a stricter limit", () => {
    const { runtime, reports } = setup(
      { "robot-01": active("cell-a"), "robot-02": active("dock-1") },
      { wind: 20, rain: 0 },
    )
    const input = new TextEncoder().encode(JSON.stringify({ zone: "dock-1", windKmh: 15 }))
    expect(onHttp(runtime, { input } as never)).toBe("Revoked: robot-02")
    expect(reports).toHaveLength(1)
  })

  test("HTTP trigger cannot relax the configured limit", () => {
    const { runtime, reports } = setup({ "robot-01": active("cell-a") }, { wind: 60, rain: 0 })
    const input = new TextEncoder().encode(JSON.stringify({ windKmh: 500 }))
    expect(onHttp(runtime, { input } as never)).toBe("Revoked: robot-01")
    expect(reports).toHaveLength(1)
  })
})
