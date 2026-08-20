/**
 * Fixed-window rate limiting.
 *
 * The authority is consume_rate_limit() in supabase/schema.sql, which decides
 * and records in one atomic statement. `evaluateRateLimit` below is the
 * reference model of the same rule, written as a pure function of (stored
 * counter, clock): tests/sql.test.js runs both over the same sequence of calls
 * and asserts they agree, so the rule stays readable in JavaScript while the
 * database remains the thing that actually enforces it.
 */

/** Question generation is the endpoint that costs money, so it is the tighter limit. */
export const GENERATION_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 };

/**
 * Answer scoring fires once per question, so a session needs more headroom.
 * Keyed on the candidate's session token, not the interview id: every candidate
 * holding the same invite link knows that id, so an interview-wide budget let
 * any one of them exhaust it and 429 the next person to finish.
 */
export const SCORING_LIMIT = { limit: 120, windowMs: 60 * 60 * 1000 };

/**
 * Starting a session. This one genuinely is per interview, because there is no
 * session yet to key it on. It is safe to share: creating a session is a single
 * cheap insert with no model call, and exhausting it delays new joins without
 * touching an interview already in progress — that one already holds its token,
 * and its answers are already saved.
 */
export const SESSION_LIMIT = { limit: 60, windowMs: 60 * 60 * 1000 };

/**
 * Credit purchases. A real user buys credits a handful of times at most, so a
 * tight limit costs nobody anything and stops the capture endpoint being used
 * to guess PayPal order ids.
 */
export const BILLING_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 };

/**
 * Decide whether a request may proceed and what the counter should become.
 *
 * @param {object} input
 * @param {number} input.now             epoch ms
 * @param {number|null} input.windowStart epoch ms of the stored window, null when there is no record
 * @param {number} input.count           requests already served in that window
 * @param {number} input.limit           requests allowed per window
 * @param {number} input.windowMs        window length in ms
 */
export function evaluateRateLimit({ now, windowStart, count, limit, windowMs }) {
  const expired = windowStart === null || now - windowStart >= windowMs;
  const effectiveStart = expired ? now : windowStart;
  const effectiveCount = expired ? 0 : count;
  const resetAt = effectiveStart + windowMs;

  if (effectiveCount >= limit) {
    return {
      allowed: false,
      count: effectiveCount,
      windowStart: effectiveStart,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  const nextCount = effectiveCount + 1;
  return {
    allowed: true,
    count: nextCount,
    windowStart: effectiveStart,
    remaining: limit - nextCount,
    resetAt,
    retryAfterSeconds: 0,
  };
}

/** Namespaced counter key, so the same user has separate budgets per endpoint. */
export function rateLimitKey(scope, identifier) {
  if (!scope || !identifier) {
    throw new Error("rateLimitKey requires both a scope and an identifier");
  }
  return `${scope}:${identifier}`;
}

/**
 * Turn a row from consume_rate_limit() into the decision the routes and the
 * response headers expect. The database has already committed the count; this
 * only reshapes it.
 *
 * @param {{allowed: boolean, hit_count: number, window_started_at: string, reset_at: string}} row
 */
export function decisionFromRow(row, { limit, now }) {
  const resetAt = new Date(row.reset_at).getTime();
  const count = Number(row.hit_count);
  const allowed = row.allowed === true;

  return {
    allowed,
    count,
    windowStart: new Date(row.window_started_at).getTime(),
    remaining: Math.max(limit - count, 0),
    resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}
