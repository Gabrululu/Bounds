import { labelhash } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanRange } from "@/services/chain";
import {
  decodeRoles,
  encodeRoles,
  fromBytes32Text,
  toBytes32Text,
  type GrantLog,
} from "@/services/guardian";
import { deriveStatus, fleet, getZone } from "@/services/robots";
import { buildEvidenceReport } from "@/services/evidence";
import { parseLabels, saveSettings } from "@/services/config";

const NOW = 1_800_000_000_000;

describe("deriveStatus", () => {
  const base = {
    revoked: false,
    expiresAt: NOW + 3_600_000,
    lastDecision: "CONTINUE" as const,
    now: NOW,
  };
  it.each([
    ["authorized", base],
    ["revoked", { ...base, revoked: true }],
    ["unlicensed", { ...base, expiresAt: 0 }],
    ["expired", { ...base, expiresAt: NOW - 1 }],
    ["expiring", { ...base, expiresAt: NOW + 60_000 }],
    ["safe-stop", { ...base, lastDecision: "UNREACHABLE" as const }],
  ])("%s", (expected, args) => {
    expect(deriveStatus(args)).toBe(expected);
  });
  it("revocation outranks everything else", () => {
    expect(deriveStatus({ ...base, revoked: true, lastDecision: "UNREACHABLE" })).toBe("revoked");
  });
});

describe("roles", () => {
  it("round-trips through the bitmap", () => {
    expect(decodeRoles(encodeRoles(["move", "enter-shared-area"]))).toEqual([
      "move",
      "enter-shared-area",
    ]);
    expect(encodeRoles(["move", "manipulate", "enter-shared-area"])).toBe(7n);
    expect(decodeRoles(0n)).toEqual([]);
  });
});

describe("scanRange", () => {
  it("covers the whole range without overlap", async () => {
    const seen: [bigint, bigint][] = [];
    await scanRange(
      0n,
      25n,
      async (from, to) => {
        seen.push([from, to]);
        return [];
      },
      10n,
    );
    expect(seen).toEqual([
      [0n, 9n],
      [10n, 19n],
      [20n, 25n],
    ]);
  });

  it("halves the chunk when the RPC rejects it, without losing blocks", async () => {
    const fetched: bigint[] = [];
    const result = await scanRange(
      0n,
      7n,
      async (from, to) => {
        if (to - from + 1n > 2n) throw new Error("range too large");
        for (let b = from; b <= to; b++) fetched.push(b);
        return [from];
      },
      8n,
      1n,
    );
    expect(fetched).toEqual([0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n]);
    expect(result).toHaveLength(4);
  });

  it("throws once the minimum chunk still fails", async () => {
    await expect(
      scanRange(0n, 10n, () => Promise.reject(new Error("down")), 4n, 1n),
    ).rejects.toThrow("down");
  });
});

describe("bytes32 text", () => {
  it("round-trips reason codes and drops the padding", () => {
    const value = toBytes32Text("WEATHER_WIND_LIMIT");
    expect(value).toHaveLength(66);
    expect(fromBytes32Text(value)).toBe("WEATHER_WIND_LIMIT");
  });
});

describe("fleet", () => {
  it("merges configured labels with labels discovered from grant logs", async () => {
    saveSettings({ ensParent: "acme.eth", robotLabels: ["robot-07"] });
    const guardian = await import("@/services/guardian");
    const spy = vi
      .spyOn(guardian, "fetchGrantLogs")
      .mockResolvedValue([{ label: "robot-07" }, { label: "robot-09" }] as GrantLog[]);
    expect(await fleet()).toEqual([
      { id: labelhash("robot-07"), label: "robot-07", ens: "robot-07.acme.eth" },
      { id: labelhash("robot-09"), label: "robot-09", ens: "robot-09.acme.eth" },
    ]);
    spy.mockRestore();
  });
  it("cleans up pasted labels", () => {
    expect(parseLabels("Robot-1, robot-2\nrobot-1")).toEqual(["robot-1", "robot-2"]);
  });
});

describe("getZone", () => {
  it("never substitutes a real zone for an unknown one", () => {
    expect(getZone("cell-a").name).toBe("Assembly Cell A");
    expect(getZone(`0x${"1".repeat(64)}`).name).toMatch(/^Unknown zone/);
  });
});

describe("buildEvidenceReport", () => {
  const robotId = labelhash("robot-07");

  beforeEach(() => {
    saveSettings({
      guardianAddress: "0x000000000000000000000000000000000000dEaD",
      ensParent: "acme.eth",
      robotLabels: ["robot-07"],
      deployBlock: "",
    });
    vi.restoreAllMocks();
  });

  it("marks every section missing when sources are empty or down, and never fabricates sources", async () => {
    const robots = await import("@/services/robots");
    vi.spyOn(robots, "getRobot").mockResolvedValue({
      id: robotId,
      ens: "robot-07.acme.eth",
    } as never);
    const guardian = await import("@/services/guardian");
    vi.spyOn(guardian, "fetchGrantLogs").mockRejectedValue(new Error("rpc down"));
    const decisions = await import("@/services/decisions");
    vi.spyOn(decisions, "listRevocationEvents").mockRejectedValue(new Error("rpc down"));

    const report = await buildEvidenceReport(robotId, NOW - 1000, NOW);

    expect(report.sections.map((s) => s.status)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
      "missing",
    ]);
    expect(report.sections.flatMap((s) => s.sources)).toEqual([]);
    expect(report.sections[0]!.note).toContain("Guardian events unavailable");
    expect(report.sections[3]!.note).toContain("CRE run history unavailable");
  });
});
