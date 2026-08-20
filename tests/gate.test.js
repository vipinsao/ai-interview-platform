/**
 * The rate limiter must engage against a caller who varies the key.
 *
 * It did not. `score-answer` and `ai-feedback` keyed on a session token that
 * was only shape-checked as a UUIDv4, `interview-session` keyed on a path
 * segment that was not checked at all, and all three consumed the budget before
 * looking the identifier up. `consume_rate_limit` is an upsert, so an unseen key
 * becomes a new row with a count of one: a fresh random UUID per request bought
 * a brand new 120-request budget every time and left a permanent counter row
 * behind. The only party the limiter ever restrained was a real candidate, whose
 * token is stable.
 *
 * These tests cover the ordering directly. `consume` is the only thing in the
 * system that writes to rate_limits, so "consume was never called" is the same
 * statement as "no row was written".
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveThenConsume } from "../lib/server/gate.js";
import { SCORING_LIMIT } from "../lib/rateLimit.js";

/** An in-memory stand-in for consume_rate_limit, with the same upsert semantics. */
function fakeLimiter({ limit = SCORING_LIMIT.limit } = {}) {
  const rows = new Map();
  return {
    rows,
    calls: [],
    async consume(key) {
      this.calls.push(key);
      const count = (rows.get(key) ?? 0) + 1;
      rows.set(key, count);
      return { allowed: count <= limit, count, remaining: Math.max(limit - count, 0), retryAfterSeconds: 0 };
    },
  };
}

const session = (token) => ({ session: { session_token: token }, interview: { questionList: [] } });

test("an unknown token is refused without spending a budget or creating a counter", async () => {
  const limiter = fakeLimiter();

  const result = await resolveThenConsume({
    resolve: async () => null,
    keyFor: () => "never reached",
    scope: "score-answer",
    config: SCORING_LIMIT,
    consume: (key, config) => limiter.consume(key, config),
  });

  assert.equal(result.outcome, "unknown");
  assert.deepEqual(limiter.calls, [], "an unknown token must not reach the limiter");
  assert.equal(limiter.rows.size, 0, "and must not leave a counter row behind");
});

test("a caller varying the key gets nothing: no budget, no rows, however many they send", async () => {
  // The reproduction. A thousand fresh UUIDs used to mean a thousand permanent
  // rows and a thousand full budgets.
  const limiter = fakeLimiter();

  for (let i = 0; i < 1000; i += 1) {
    const result = await resolveThenConsume({
      resolve: async () => null,
      keyFor: () => `unknown-${i}`,
      scope: "score-answer",
      config: SCORING_LIMIT,
      consume: (key, config) => limiter.consume(key, config),
    });
    assert.equal(result.outcome, "unknown");
  }

  assert.equal(limiter.rows.size, 0);
  assert.equal(limiter.calls.length, 0);
});

test("a known token is still limited, exactly at the limit", async () => {
  const limiter = fakeLimiter({ limit: 3 });
  const config = { limit: 3, windowMs: 1000 };

  const outcomes = [];
  for (let i = 0; i < 5; i += 1) {
    const result = await resolveThenConsume({
      resolve: async () => session("11111111-1111-4111-8111-111111111111"),
      keyFor: (found) => found.session.session_token,
      scope: "score-answer",
      config,
      consume: (key) => limiter.consume(key),
    });
    outcomes.push(result.outcome);
  }

  assert.deepEqual(outcomes, ["ok", "ok", "ok", "limited", "limited"]);
  assert.equal(limiter.rows.size, 1, "one real session is one counter, not five");
});

test("the counter is keyed on the identifier the database returned, not the one the caller sent", async () => {
  // The caller's string and the stored token are different objects here on
  // purpose: keying on the request body is what let the key be chosen.
  const limiter = fakeLimiter();

  const result = await resolveThenConsume({
    resolve: async () => session("22222222-2222-4222-8222-222222222222"),
    keyFor: (found) => found.session.session_token,
    scope: "ai-feedback",
    config: SCORING_LIMIT,
    consume: (key) => limiter.consume(key),
  });

  assert.equal(result.outcome, "ok");
  assert.deepEqual(limiter.calls, ["ai-feedback:22222222-2222-4222-8222-222222222222"]);
});

test("the subject is handed back, so the route does not look it up twice", async () => {
  const limiter = fakeLimiter();
  const subject = session("33333333-3333-4333-8333-333333333333");
  let lookups = 0;

  const result = await resolveThenConsume({
    resolve: async () => {
      lookups += 1;
      return subject;
    },
    keyFor: (found) => found.session.session_token,
    scope: "score-answer",
    config: SCORING_LIMIT,
    consume: (key) => limiter.consume(key),
  });

  assert.equal(lookups, 1);
  assert.equal(result.subject, subject);
});

// ---------------------------------------------------------------------------
// The ordering, asserted where it actually lives.
//
// The route handlers cannot be imported here: they resolve "@/lib/..." through
// the Next.js alias, which the plain node test runner does not implement, and
// their dependencies are ESM bindings that cannot be substituted without a
// module-mocking loader. So this reads the three routes and checks the property
// that the defect was: the identifier is resolved before the budget is spent.
//
// It is a source check and it is worth saying so. It cannot prove the routes
// behave correctly - resolveThenConsume above is what proves that - but it does
// fail on the code as it stood, and it fails again the moment anyone reorders
// these two calls.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ROUTES = [
  { file: "app/api/score-answer/route.js", resolver: "findSessionWithInterview" },
  { file: "app/api/ai-feedback/route.js", resolver: "findSessionWithInterview" },
  { file: "app/api/interview/[interview_id]/session/route.js", resolver: "findInterview" },
];

for (const { file, resolver } of ROUTES) {
  test(`${file} resolves the subject before it spends the budget`, () => {
    // From the handler body, not the file: both names appear in the import
    // block first, in whatever order the imports happen to sit.
    const source = readFileSync(join(root, file), "utf8");
    const body = source.slice(source.indexOf("export async function POST"));

    const resolvedAt = body.indexOf(`${resolver}(`);
    const consumedAt = body.indexOf("consumeRateLimit");
    assert.ok(resolvedAt > 0, `${file} should still call ${resolver}`);
    assert.ok(consumedAt > 0, `${file} should still consume a rate limit`);
    assert.ok(
      resolvedAt < consumedAt,
      `${file} consumes the rate limit before resolving the subject, so an unknown key ` +
        "creates a counter row and buys a fresh budget"
    );
  });

  test(`${file} keys the limiter through the gate, not on the request`, () => {
    const source = readFileSync(join(root, file), "utf8");
    assert.match(source, /resolveThenConsume\(/, `${file} should route its limiter through the gate`);
    assert.doesNotMatch(
      source,
      /rateLimitKey\(/,
      `${file} should not build its own limiter key from caller-supplied input`
    );
  });
}
