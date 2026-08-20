import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRateLimit, rateLimitKey } from "../lib/rateLimit.js";

const WINDOW = 60_000;
const LIMIT = 3;

test("allows the first request when no counter exists", () => {
  const decision = evaluateRateLimit({
    now: 1_000,
    windowStart: null,
    count: 0,
    limit: LIMIT,
    windowMs: WINDOW,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.count, 1);
  assert.equal(decision.remaining, 2);
  assert.equal(decision.windowStart, 1_000);
});

test("denies once the limit is reached inside the window", () => {
  const decision = evaluateRateLimit({
    now: 30_000,
    windowStart: 0,
    count: LIMIT,
    limit: LIMIT,
    windowMs: WINDOW,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.remaining, 0);
  assert.equal(decision.retryAfterSeconds, 30);
});

test("starts a fresh window once the old one has elapsed", () => {
  const decision = evaluateRateLimit({
    now: 60_000,
    windowStart: 0,
    count: LIMIT,
    limit: LIMIT,
    windowMs: WINDOW,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.count, 1);
  assert.equal(decision.windowStart, 60_000);
});

test("the last request inside the budget is allowed and reports no remaining", () => {
  const decision = evaluateRateLimit({
    now: 10,
    windowStart: 0,
    count: LIMIT - 1,
    limit: LIMIT,
    windowMs: WINDOW,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.remaining, 0);
});

test("keys are namespaced per endpoint so budgets do not bleed", () => {
  assert.equal(rateLimitKey("ai-model", "user-1"), "ai-model:user-1");
  assert.notEqual(rateLimitKey("ai-model", "u"), rateLimitKey("score-answer", "u"));
  assert.throws(() => rateLimitKey("ai-model", ""), /identifier/);
});
