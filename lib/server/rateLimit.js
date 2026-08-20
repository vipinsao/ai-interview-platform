/**
 * Persistence for the fixed-window rate limiter.
 *
 * The decision is made inside Postgres by consume_rate_limit() (see
 * supabase/schema.sql), in a single INSERT ... ON CONFLICT DO UPDATE. This
 * module only passes the parameters and reshapes the answer.
 *
 * It used to read the counter, decide in JavaScript, then write it back. Two
 * requests arriving together both read the same count and both were admitted —
 * a limit of 20 would pass 21, 22, or more under load, which is the one
 * condition a rate limiter exists to handle. tests/sql.test.js re-enacts that
 * race and then shows the current implementation refusing it.
 *
 * Counters are written with the service-role key so a user cannot clear their
 * own budget. If that key is missing the limiter cannot do its job, and the
 * route refuses the request rather than quietly running unlimited — an
 * unmetered LLM endpoint open to the internet is the failure this exists to
 * prevent.
 */
import { decisionFromRow } from "../rateLimit.js";
import { serverAdminClient } from "./supabase.js";

export class RateLimitUnavailableError extends Error {
  constructor(message) {
    super(`rate limiting is unavailable: ${message}`);
    this.name = "RateLimitUnavailableError";
  }
}

export async function consumeRateLimit(key, { limit, windowMs }, now = Date.now()) {
  const { data, error } = await serverAdminClient().rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
    p_now: new Date(now).toISOString(),
  });

  if (error) throw new RateLimitUnavailableError(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new RateLimitUnavailableError("the limiter returned no decision");

  return decisionFromRow(row, { limit, now });
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
