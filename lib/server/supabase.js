import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env.js";

const SUPABASE_HINT = "Copy it from your Supabase project settings, API tab.";

/** Anon-key client for server-side reads that RLS already allows (e.g. a public interview link). */
export function serverAnonClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_HINT),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", SUPABASE_HINT),
    { auth: { persistSession: false } }
  );
}

/**
 * Service-role client. Server only — this key bypasses row level security, so
 * it must never be given a NEXT_PUBLIC_ name or reach the browser bundle.
 * Used solely to maintain the rate limit counters, which a user must not be
 * able to reset for themselves.
 */
export function serverAdminClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_HINT),
    requireEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      "Copy the service_role key from your Supabase project settings, API tab. Never expose it to the browser."
    ),
    { auth: { persistSession: false } }
  );
}
