import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigError, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

/** The anon key is public by design: row level security allows reads only. */
export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  return client;
}

export function requireSupabase(): SupabaseClient {
  const c = getSupabase();
  if (!c)
    throw new ConfigError(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  return c;
}
