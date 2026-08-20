import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Without this the failure surfaces as "supabaseUrl is required" from inside
// the Supabase client, which gives no hint about what to set or where.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. " +
      "Copy .env.example to .env.local and fill in the values from your Supabase project settings (API tab)."
  );
}

// Single browser client. The anon key is safe to ship: it only grants what the
// row level security policies in supabase/schema.sql allow.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
