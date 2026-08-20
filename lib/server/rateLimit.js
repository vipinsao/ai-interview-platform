/**
 * Persistence for the fixed-window rate limiter. The decision itself lives in
 * lib/rateLimit.js and is unit tested there.
 *
 * Counters are written with the service-role key so a user cannot clear their
 * own budget. If that key is missing the limiter cannot do its job, and the
 * route refuses the request rather than quietly running unlimited — an
 * unmetered LLM endpoint open to the internet is the failure this exists to
 * prevent.
 *
 * Known limitation: read-then-write is not atomic, so two requests arriving in
 * the same instant can both be admitted. At one request per spoken answer that
 * is not worth a lock; the fix would be a Postgres function doing the
 * increment in one statement.
 */
import { evaluateRateLimit } from "../rateLimit.js";
import { serverAdminClient } from "./supabase.js";

export class RateLimitUnavailableError extends Error {
  constructor(message) {
    super(`rate limiting is unavailable: ${message}`);
    this.name = "RateLimitUnavailableError";
  }
}

export async function consumeRateLimit(key, { limit, windowMs }, now = Date.now()) {
  const db = serverAdminClient();

  const { data, error } = await db
    .from("rate_limits")
    .select("window_start, count")
    .eq("key", key)
    .maybeSingle();

  if (error) throw new RateLimitUnavailableError(error.message);

  const decision = evaluateRateLimit({
    now,
    windowStart: data?.window_start ? Date.parse(data.window_start) : null,
    count: data?.count ?? 0,
    limit,
    windowMs,
  });

  if (decision.allowed) {
    const { error: writeError } = await db.from("rate_limits").upsert(
      {
        key,
        window_start: new Date(decision.windowStart).toISOString(),
        count: decision.count,
      },
      { onConflict: "key" }
    );
    if (writeError) throw new RateLimitUnavailableError(writeError.message);
  }

  return decision;
}

/** Standard headers so a client can see its budget without guessing. */
export function rateLimitHeaders(decision, limit) {
  const headers = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": new Date(decision.resetAt).toISOString(),
  };
  if (!decision.allowed) {
    headers["Retry-After"] = String(decision.retryAfterSeconds);
  }
  return headers;
}
