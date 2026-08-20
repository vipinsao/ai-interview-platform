import test from "node:test";
import assert from "node:assert/strict";
import { CREDIT_PLANS, planForCents, toCents } from "../lib/plans.js";

test("plan prices are unique, because a payment is resolved by its amount", () => {
  const prices = CREDIT_PLANS.map((plan) => toCents(plan.price));
  assert.equal(
    new Set(prices).size,
    prices.length,
    "two plans at the same price would make the amount ambiguous"
  );
});

test("every plan has a usable price and a positive number of credits", () => {
  for (const plan of CREDIT_PLANS) {
    assert.notEqual(toCents(plan.price), null, `${plan.id} has an unusable price`);
    assert.equal(Number.isInteger(plan.credits) && plan.credits > 0, true);
  }
});

test("money is compared as whole cents", () => {
  assert.equal(toCents("5.00"), 500);
  assert.equal(toCents("5"), 500);
  assert.equal(toCents("12.34"), 1234);
  assert.equal(toCents(5), 500);
});

test("anything that is not a plain amount is rejected rather than coerced", () => {
  for (const value of ["", " ", "5.001", "-5.00", "1e3", "abc", null, undefined, {}, NaN]) {
    assert.equal(toCents(value), null, `${String(value)} should not parse as money`);
  }
});

test("an amount that matches no plan resolves to no plan", () => {
  assert.equal(planForCents(1), null, "a one cent order buys nothing");
  assert.equal(planForCents(499), null);
  assert.equal(planForCents(null), null);
  assert.equal(planForCents(500)?.credits, 20);
});
