export function corsHeaders(
  request: Request,
  allowedOrigins: string | undefined,
): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = (allowedOrigins ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin =
    allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : (allowed[0] ?? "");
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-headers":
      "authorization, apikey, content-type, x-client-info, x-bounds-secret",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "origin",
  };
}

export function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Constant-time compare. An unset server secret never matches, so endpoints fail closed. */
export function secretMatches(expected: string | undefined, provided: string | null): boolean {
  if (!expected || provided === null) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Reads a JSON body, returning null if it is larger than maxBytes or not valid JSON. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const ROBOT_LABEL = /^[a-z0-9-]{1,63}$/;
