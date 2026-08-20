/**
 * Spend a rate limit budget only once the thing it belongs to is known to
 * exist.
 *
 * Every unauthenticated route here keys its limiter on an identifier the caller
 * supplies: `score-answer` and `ai-feedback` on a session token that was only
 * shape-checked as a UUIDv4, `interview-session` on a path segment that was not
 * checked at all. All three consumed the budget *before* looking the identifier
 * up, on the reasoning that an unknown token must not buy an unmetered database
 * read.
 *
 * That reasoning inverts the control. `consume_rate_limit` is an upsert: a key
 * it has never seen becomes a new row with a count of one. So a caller who sent
 * a freshly generated UUID with every request got a brand new 120-request
 * budget every time and left a permanent row behind, and the limiter never
 * engaged against them at all — while a real candidate, whose token is stable,
 * was the only party it ever restrained. The credits work names this limiter as
 * the real spend gate; against a caller who varies the key it was not a gate.
 *
 * Resolving first costs an unknown token one indexed primary-key lookup — no
 * model call, no write, no row. That is the trade this makes, and it is the
 * right way round: the budget now protects what is actually expensive, and it
 * is keyed on an identifier the database issued rather than one the caller
 * invented.
 */
import { rateLimitKey } from "../rateLimit.js";

/**
 * @param {object} input
 * @param {() => Promise<any>} input.resolve  looks the subject up; null/undefined means unknown
 * @param {(subject: any) => string} input.keyFor identifier to meter, taken from the RESOLVED subject
 * @param {string} input.scope                limiter namespace
 * @param {{limit: number, windowMs: number}} input.config
 * @param {(key: string, config: object) => Promise<object>} input.consume
 * @returns {Promise<{outcome: "unknown"} | {outcome: "ok"|"limited", decision: object, subject: any}>}
 */
export async function resolveThenConsume({ resolve, keyFor, scope, config, consume }) {
  const subject = await resolve();

  // No budget is spent and no counter row is created for something that does
  // not exist. This ordering is the fix; a test asserts `consume` is never
  // reached, because `consume` is the only thing that writes to rate_limits.
  if (!subject) return { outcome: "unknown" };

  const decision = await consume(rateLimitKey(scope, keyFor(subject)), config);
  return { outcome: decision.allowed ? "ok" : "limited", decision, subject };
}
