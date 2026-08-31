import { createClient } from "@supabase/supabase-js";

/**
 * The browser Supabase client, created on first use rather than on import.
 *
 * The guard below is worth keeping: without it the failure surfaces as
 * "supabaseUrl is required" from inside the Supabase client, which gives no
 * hint about what to set or where. What was wrong was *when* it fired.
 *
 * `Provider` is mounted in the root layout, and it imports this module, so
 * every route in the app imported it transitively. Throwing at module scope
 * therefore made the module unimportable, and `next build` died prerendering
 * `/_not-found` — a page that never touches Supabase — with the message above.
 * A fresh clone could not be built at all without first creating a Supabase
 * project, which is a poor first five minutes for anyone evaluating the repo.
 *
 * Same guard, same message, moved to first use: configuration is still
 * mandatory to *run* the app, and is no longer required to *build* it.
 */
function createBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. " +
        "Copy .env.example to .env.local and fill in the values from your Supabase project settings (API tab)."
    );
  }

  // Single browser client. The anon key is safe to ship: it only grants what
  // the row level security policies in supabase/schema.sql allow.
  return createClient(supabaseUrl, supabaseAnonKey);
}

/** @type {ReturnType<typeof createClient> | null} */
let client = null;

/** The client, created on the first call and reused after that. */
export function getSupabase() {
  if (client === null) client = createBrowserClient();
  return client;
}

/**
 * Kept as a property-access facade so the nine existing call sites keep their
 * `supabase.auth.…` / `supabase.from(…)` / `supabase.rpc(…)` shape. Touching
 * any property is what constructs the client, so the guard still fires on the
 * first real use — just not on import.
 */
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const instance = getSupabase();
      const value = Reflect.get(instance, prop);
      return typeof value === "function" ? value.bind(instance) : value;
    },
    has(_target, prop) {
      return Reflect.has(getSupabase(), prop);
    },
  }
);
