/**
 * Fixed-window rate limiting.
 *
 * The decision is a pure function of (stored counter, clock) so it can be
 * unit tested without a database. lib/server/rateLimit.js supplies the
 * persistence.
 */

/** Question generation is the endpoint that costs money, so it is the tighter limit. */
export const GENERATION_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 };

/** Answer scoring fires once per question, so a session needs more headroom. */
export const SCORING_LIMIT = { limit: 120, windowMs: 60 * 60 * 1000 };

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
