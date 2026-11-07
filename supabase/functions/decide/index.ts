// POST /functions/v1/decide
// Headers: x-bounds-secret. Body: { robotLabel, frame } where frame is base64 or a data URL.
import { createClient } from "npm:@supabase/supabase-js@2";
import { labelhash } from "npm:viem@2";
import { decide, toDataUrl, toDecisionRow } from "../_shared/decide-core.ts";
import { ROBOT_LABEL, corsHeaders, json, readJson, secretMatches } from "../_shared/http.ts";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

const env = (name: string) => Deno.env.get(name);

Deno.serve(async (request) => {
  const cors = corsHeaders(request, env("ALLOWED_ORIGINS"));
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
  if (!secretMatches(env("BOUNDS_API_SECRET"), request.headers.get("x-bounds-secret"))) {
    return json({ error: "Unauthorized" }, 401, cors);
  }

  const body = (await readJson(request, MAX_BODY_BYTES)) as {
    robotLabel?: unknown;
    frame?: unknown;
  } | null;
  const robotLabel = typeof body?.robotLabel === "string" ? body.robotLabel : "";
  const frame = typeof body?.frame === "string" ? toDataUrl(body.frame) : null;
  if (!ROBOT_LABEL.test(robotLabel) || !frame) {
    return json(
      { error: "Expected robotLabel and a base64 jpeg, png or webp frame under 8 MB." },
      400,
      cors,
    );
  }

  const model = env("ZEROG_VISION_MODEL") ?? "0gm-1.0-35b-a3b";
  const result = await decide(frame, robotLabel, {
    apiKey: env("ZEROG_API_KEY"),
    routerUrl: env("ZEROG_ROUTER_URL") ?? "https://router-api.0g.ai/v1",
    model,
    timeoutMs: TIMEOUT_MS,
    fetch,
  });

  // A storage failure must not change or delay what the robot is told. It is logged instead.
  try {
    const db = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { error } = await db
      .from("decisions")
      .insert(toDecisionRow(robotLabel, labelhash(robotLabel), model, result));
    if (error) console.error("decisions insert failed", error.message);
  } catch (error) {
    console.error("decisions insert failed", error);
  }

  return json(result, 200, cors);
});
