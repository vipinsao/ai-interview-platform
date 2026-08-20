/**
 * What the server needs before it can serve anything.
 *
 * The README used to claim the app "throws on startup naming anything that is
 * missing". It did not: requireEnv() is only reached when a request builds a
 * client, so a deployment with no service-role key looked healthy and failed on
 * the first user. instrumentation.js now calls assertServerEnv() when the
 * server process starts, which is what makes that sentence true.
 *
 * Deliberately not checked at build time: compiling the bundle does not need
 * anybody's secrets, and a build that demands production credentials is a
 * build nobody can run.
 */

/** Required in every environment. Each entry says where to get the value. */
export const REQUIRED_ENV = [
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    hint: "Supabase dashboard -> Project Settings -> API -> Project URL.",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    hint: "Same page, under Project API keys. Safe to ship to the browser.",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    hint: "Same page. Server only — it bypasses row level security.",
  },
  {
    name: "LLM_API_KEY",
    hint: "A free Groq key from https://console.groq.com/keys.",
  },
  {
    name: "NEXT_PUBLIC_HOST_URL",
    hint: "The origin used to build shareable interview links, e.g. http://localhost:3000.",
  },
];

/**
 * Billing is optional — the app runs without it and the purchase buttons
 * explain themselves. But half-configured billing is worse than none: a client
 * id with no secret gives the user a PayPal window and then a server that
 * cannot verify what they paid. So it is all three or nothing.
 */
export const PAYPAL_ENV = [
  {
    name: "NEXT_PUBLIC_PAYPAL_CLIENT_ID",
    hint: "Sandbox app at https://developer.paypal.com/dashboard/applications.",
  },
  {
    name: "PAYPAL_CLIENT_SECRET",
    hint: "The same PayPal app's secret. Server only.",
  },
];

function present(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "";
}

/** @returns {Array<{name: string, hint: string}>} everything that must be set and is not */
export function missingEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter((entry) => !present(env, entry.name));

  const paypalSet = PAYPAL_ENV.filter((entry) => present(env, entry.name));
  if (paypalSet.length > 0 && paypalSet.length < PAYPAL_ENV.length) {
    missing.push(
      ...PAYPAL_ENV.filter((entry) => !present(env, entry.name)).map((entry) => ({
        ...entry,
        hint: `${entry.hint} Billing is half-configured: set all of ${PAYPAL_ENV.map(
          (e) => e.name
        ).join(", ")}, or none of them.`,
      }))
    );
  }

  return missing;
}

export class StartupConfigError extends Error {
  constructor(missing) {
    super(
      [
        `Missing configuration: ${missing.length} environment variable${
          missing.length === 1 ? " is" : "s are"
        } not set.`,
        ...missing.map((entry) => `  - ${entry.name}: ${entry.hint}`),
        "See .env.example.",
      ].join("\n")
    );
    this.name = "StartupConfigError";
    this.missing = missing.map((entry) => entry.name);
  }
}

/**
 * Called from instrumentation.js when the server process starts.
 *
 * A production server refuses to start: deploying without a service-role key is
 * a broken deployment, and it should fail at boot rather than on whichever user
 * happens to click first.
 *
 * A development server starts anyway and prints the same list. That is not a
 * softer rule for its own sake — it is what lets `cp .env.example .env.local &&
 * npm run dev` render the entire UI with placeholder Supabase values, so
 * somebody evaluating this project can look around before opening four accounts.
 * Whatever they then try to use tells them plainly that it is not configured.
 *
 * @param {"production"|"development"|string} mode
 */
export function assertServerEnv(env = process.env, mode = env.NODE_ENV) {
  const missing = missingEnv(env);
  if (missing.length === 0) return;

  const error = new StartupConfigError(missing);
  if (mode === "production") throw error;

  console.warn(
    `\n${error.message}\nThe development server will start anyway. Anything that needs these will say so.\n`
  );
}
