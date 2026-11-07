import { describe, expect, it, vi } from "vitest";
import { decide, parseModelOutput, toDataUrl, toDecisionRow, type DecideDeps } from "./decide-core";
import { parseEpisode, verifyRootHash } from "./episode-core";
import { corsHeaders, secretMatches } from "./http";

const deps = (fetchImpl: unknown, overrides: Partial<DecideDeps> = {}): DecideDeps => ({
  apiKey: "key",
  routerUrl: "https://router.test/v1",
  model: "m",
  timeoutMs: 50,
  fetch: fetchImpl as typeof fetch,
  ...overrides,
});

const routerReply = (
  content: string,
  trace: unknown = { request_id: "req-1", tee_verified: true },
) =>
  vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content } }], x_0g_trace: trace })),
    );

const UNREACHABLE = { action: "STOP", unreachable: true };

describe("decide", () => {
  it("returns the model's decision with request ID and TEE status", async () => {
    const result = await decide(
      "data:x",
      "robot-1",
      deps(routerReply('{"action":"SLOW","reason":"person near"}')),
    );
    expect(result).toEqual({
      action: "SLOW",
      reason: "person near",
      requestId: "req-1",
      teeVerified: true,
    });
  });

  it("requests TEE verification", async () => {
    const fetchImpl = routerReply('{"action":"CONTINUE","reason":"clear"}');
    await decide("data:x", "robot-1", deps(fetchImpl));
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).verify_tee).toBe(true);
  });

  it.each([
    ["network error", vi.fn().mockRejectedValue(new Error("down"))],
    ["HTTP error", vi.fn().mockResolvedValue(new Response("{}", { status: 503 }))],
    ["non-JSON body", vi.fn().mockResolvedValue(new Response("<html>"))],
    ["unknown action", routerReply('{"action":"GO","reason":"x"}')],
    ["prose reply", routerReply("the path looks clear")],
  ])("never invents a decision on %s", async (_name, fetchImpl) => {
    expect(await decide("data:x", "robot-1", deps(fetchImpl))).toEqual(UNREACHABLE);
  });

  it("returns unreachable when the router hangs past the timeout", async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    expect(await decide("data:x", "robot-1", deps(hang))).toEqual(UNREACHABLE);
  });

  it("returns unreachable without calling out when no API key is set", async () => {
    const fetchImpl = vi.fn();
    expect(await decide("data:x", "robot-1", deps(fetchImpl, { apiKey: undefined }))).toEqual(
      UNREACHABLE,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", { request_id: "req-1", tee_verified: false }],
    ["absent", { request_id: "req-1" }],
  ])("stops instead of trusting CONTINUE when TEE verification is %s", async (_name, trace) => {
    const result = await decide(
      "data:x",
      "robot-1",
      deps(routerReply('{"action":"CONTINUE","reason":"clear"}', trace)),
    );
    expect(result).toMatchObject({ action: "STOP", teeVerified: false, requestId: "req-1" });
  });
});

describe("decision rows", () => {
  it("stores unreachable with no request ID and no TEE claim", () => {
    const row = toDecisionRow("robot-1", "0xabc", "m", { action: "STOP", unreachable: true });
    expect(row).toMatchObject({ kind: "UNREACHABLE", request_id: null, tee_verified: false });
  });
});

describe("parsing helpers", () => {
  it("extracts JSON from a code fence", () => {
    expect(parseModelOutput('```json\n{"action":"STOP","reason":"person"}\n```')).toEqual({
      action: "STOP",
      reason: "person",
    });
  });

  it("recognizes frames by signature and rejects anything else", () => {
    expect(toDataUrl("/9j/AAAA")).toBe("data:image/jpeg;base64,/9j/AAAA");
    expect(toDataUrl("iVBORw0K")).toBe("data:image/png;base64,iVBORw0K");
    expect(toDataUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(toDataUrl("AAAA")).toBeNull();
    expect(toDataUrl("data:text/html;base64,AAAA")).toBeNull();
  });
});

describe("secretMatches", () => {
  it("fails closed", () => {
    expect(secretMatches(undefined, "x")).toBe(false);
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("abc", null)).toBe(false);
    expect(secretMatches("abc", "abd")).toBe(false);
    expect(secretMatches("abc", "abcd")).toBe(false);
    expect(secretMatches("abc", "abc")).toBe(true);
  });
});

describe("corsHeaders", () => {
  const request = (origin: string) => new Request("https://x.test", { headers: { origin } });
  it("only echoes configured origins", () => {
    expect(
      corsHeaders(request("https://evil.test"), "https://app.test")["access-control-allow-origin"],
    ).toBe("https://app.test");
    expect(
      corsHeaders(request("https://app.test"), "https://app.test")["access-control-allow-origin"],
    ).toBe("https://app.test");
  });
});

describe("parseEpisode", () => {
  const valid = {
    robotLabel: "robot-1",
    startedAt: "2026-11-06T00:00:00Z",
    durationSec: 60,
    decisions: [],
    requestIds: ["a"],
    permissionSnapshot: { roles: 1 },
  };
  it("accepts a valid episode", () => {
    expect(parseEpisode(valid)).toHaveProperty("episode");
  });
  it.each([
    [{ ...valid, robotLabel: "Bad Label" }],
    [{ ...valid, startedAt: "nope" }],
    [{ ...valid, durationSec: -1 }],
    [{ ...valid, decisions: {} }],
    [{ ...valid, requestIds: [1] }],
    [{ ...valid, permissionSnapshot: [] }],
    [null],
  ])("rejects %j", (body) => {
    expect(parseEpisode(body)).toHaveProperty("error");
  });
});

describe("verifyRootHash", () => {
  const root = `0x${"ab".repeat(32)}`;
  const bytes = new Uint8Array([1]);
  it("passes when the recomputed root matches", async () => {
    const result = await verifyRootHash(root, {
      download: async () => [bytes, null],
      computeRoot: async () => root.toUpperCase().replace("0X", "0x"),
    });
    expect(result).toEqual({ ok: true });
  });
  it("fails when the data does not match", async () => {
    const result = await verifyRootHash(root, {
      download: async () => [bytes, null],
      computeRoot: async () => `0x${"cd".repeat(32)}`,
    });
    expect(result.ok).toBe(false);
  });
  it("reports a returned download error", async () => {
    const result = await verifyRootHash(root, {
      download: async () => [null, new Error("File not finalized")],
      computeRoot: async () => root,
    });
    expect(result).toEqual({ ok: false, reason: "File not finalized" });
  });
  it("reports a thrown download error", async () => {
    const result = await verifyRootHash(root, {
      download: async () => {
        throw new Error("file not found");
      },
      computeRoot: async () => root,
    });
    expect(result).toEqual({ ok: false, reason: "file not found" });
  });
});
