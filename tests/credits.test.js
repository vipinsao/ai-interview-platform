/**
 * The credit granting path, end to end, with PayPal and the database stubbed.
 *
 * The vulnerability these cover: PayButton used to add credits from the browser
 * in its onApprove handler, with no capture and no verification. Anyone holding
 * the anon key — which ships to every visitor — could grant themselves any
 * number of credits without paying. Every test below is a way that attack, or a
 * variation of it, is now refused.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { canSpendCredit, resolveGrant } from "../lib/credits.js";
import { normaliseOrder, paypalBaseUrl } from "../lib/server/paypal.js";
import { PURCHASE_OUTCOME, processCreditPurchase } from "../lib/server/credits.js";

const BUYER = "buyer@example.com";

/** A PayPal capture response, trimmed to the fields the app reads. */
function capturedOrder({
  id = "ORDER1",
  status = "COMPLETED",
  value = "5.00",
  currency = "USD",
  units = 1,
  captureStatus = "COMPLETED",
} = {}) {
  return {
    id,
    status,
    purchase_units: Array.from({ length: units }, () => ({
      payments: {
        captures: [
          {
            id: "CAPTURE1",
            status: captureStatus,
            amount: { currency_code: currency, value },
          },
        ],
      },
    })),
  };
}

/**
 * Stands in for the database. grantCredits mirrors what
 * grant_purchased_credits() does in Postgres: the ledger insert carries the
 * primary key, so a second attempt at the same order id inserts nothing and
 * the balance is left alone.
 */
function fakeStore({ balances = {} } = {}) {
  const purchases = new Map();
  const balance = new Map(Object.entries(balances));

  return {
    purchases,
    balance,
    async findPurchase(orderId) {
      return purchases.get(orderId) ?? null;
    },
    async grantCredits({ orderId, userEmail, credits }) {
      if (purchases.has(orderId)) {
        return { granted: false, creditsTotal: balance.get(userEmail) ?? null };
      }
      purchases.set(orderId, {
        paypal_order_id: orderId,
        user_email: userEmail,
        credits_granted: credits,
      });
      const total = (balance.get(userEmail) ?? 0) + credits;
      balance.set(userEmail, total);
      return { granted: true, creditsTotal: total };
    },
    async creditsFor(email) {
      return balance.get(email) ?? null;
    },
  };
}

function fakePayPal(payload) {
  const client = {
    captures: 0,
    async captureOrder(orderId) {
      client.captures += 1;
      return normaliseOrder(
        typeof payload === "function" ? payload(orderId) : payload
      );
    },
  };
  return client;
}

// -----------------------------------------------------------------------------
// Granting
// -----------------------------------------------------------------------------

test("a completed five dollar order grants the twenty credits that plan sells", async () => {
  const store = fakeStore({ balances: { [BUYER]: 3 } });
  const result = await processCreditPurchase({
    orderId: "ORDER1",
    userEmail: BUYER,
    paypal: fakePayPal(capturedOrder()),
    store,
  });

  assert.equal(result.outcome, PURCHASE_OUTCOME.granted);
  assert.equal(result.credits, 20);
  assert.equal(result.creditsTotal, 23);
});

test("the number of credits follows the amount PayPal reports, not the plan the client picked", async () => {
  const store = fakeStore();
  const result = await processCreditPurchase({
    orderId: "ORDER-PRO",
    userEmail: BUYER,
    paypal: fakePayPal(capturedOrder({ value: "25.00" })),
    store,
  });

  assert.equal(result.credits, 120, "25.00 is the Pro plan, whatever the browser asked for");
});

// -----------------------------------------------------------------------------
// Replay
// -----------------------------------------------------------------------------

test("replaying the same order id grants credits only once", async () => {
  const store = fakeStore({ balances: { [BUYER]: 3 } });
  const paypal = fakePayPal(capturedOrder());

  const first = await processCreditPurchase({
    orderId: "ORDER1",
    userEmail: BUYER,
    paypal,
    store,
  });
  const second = await processCreditPurchase({
    orderId: "ORDER1",
    userEmail: BUYER,
    paypal,
    store,
  });

  assert.equal(first.outcome, PURCHASE_OUTCOME.granted);
  assert.equal(second.outcome, PURCHASE_OUTCOME.alreadyGranted);
  assert.equal(store.balance.get(BUYER), 23, "the replay must not add a second lot");
  assert.equal(paypal.captures, 1, "the replay is answered from the ledger, not from PayPal");
  assert.equal(store.purchases.size, 1);
});

test("two simultaneous captures of one order id grant one lot of credits", async () => {
  // Both requests get past the ledger lookup before either has written a row —
  // the case the cheap pre-check cannot catch. The unique key decides it.
  const store = fakeStore({ balances: { [BUYER]: 0 } });
  let lookups = 0;
  const racing = {
    ...store,
    async findPurchase(orderId) {
      lookups += 1;
      // The first two lookups are the two racing requests' pre-checks.
      if (lookups <= 2) return null;
      return store.findPurchase(orderId);
    },
  };

  const paypal = fakePayPal(capturedOrder());
  const results = await Promise.all([
    processCreditPurchase({ orderId: "ORDER1", userEmail: BUYER, paypal, store: racing }),
    processCreditPurchase({ orderId: "ORDER1", userEmail: BUYER, paypal, store: racing }),
  ]);

  const granted = results.filter((r) => r.outcome === PURCHASE_OUTCOME.granted);
  const already = results.filter((r) => r.outcome === PURCHASE_OUTCOME.alreadyGranted);
  assert.equal(granted.length, 1);
  assert.equal(already.length, 1);
  assert.equal(store.balance.get(BUYER), 20, "only one lot of credits was added");
});

test("replaying someone else's order id grants nothing and says nothing about it", async () => {
  const store = fakeStore({ balances: { [BUYER]: 0, "thief@example.com": 0 } });
  const paypal = fakePayPal(capturedOrder());

  await processCreditPurchase({ orderId: "ORDER1", userEmail: BUYER, paypal, store });
  const stolen = await processCreditPurchase({
    orderId: "ORDER1",
    userEmail: "thief@example.com",
    paypal,
    store,
  });

  assert.equal(stolen.outcome, PURCHASE_OUTCOME.notYours);
  assert.equal(stolen.credits, undefined);
  assert.equal(store.balance.get("thief@example.com"), 0);
});

// -----------------------------------------------------------------------------
// Orders that must not grant anything
// -----------------------------------------------------------------------------

test("an order that is not COMPLETED grants nothing", async () => {
  const store = fakeStore({ balances: { [BUYER]: 3 } });
  const result = await processCreditPurchase({
    orderId: "ORDER1",
    userEmail: BUYER,
    paypal: fakePayPal(capturedOrder({ status: "CREATED", captureStatus: "PENDING" })),
    store,
  });

  assert.equal(result.outcome, PURCHASE_OUTCOME.refused);
  assert.equal(store.balance.get(BUYER), 3);
  assert.equal(store.purchases.size, 0, "nothing is written for a payment that did not happen");
});

test("a one cent order buys nothing, because no plan is sold at that price", async () => {
  const store = fakeStore({ balances: { [BUYER]: 3 } });
  const result = await processCreditPurchase({
    orderId: "ORDER1",
    userEmail: BUYER,
    paypal: fakePayPal(capturedOrder({ value: "0.01" })),
    store,
  });

  assert.equal(result.outcome, PURCHASE_OUTCOME.refused);
  assert.match(result.reason, /no plan is sold/);
  assert.equal(store.balance.get(BUYER), 3);
});

test("an order in another currency grants nothing", () => {
  const grant = resolveGrant(
    normaliseOrder(capturedOrder({ value: "5.00", currency: "INR" }))
  );
  assert.equal(grant.ok, false);
  assert.match(grant.reason, /INR/);
});

test("an order with more than one purchase unit grants nothing", () => {
  const grant = resolveGrant(normaliseOrder(capturedOrder({ units: 2 })));
  assert.equal(grant.ok, false);
  assert.match(grant.reason, /purchase units/);
});

test("an order with no completed capture grants nothing", () => {
  const grant = resolveGrant(
    normaliseOrder(capturedOrder({ captureStatus: "DECLINED" }))
  );
  assert.equal(grant.ok, false);
  assert.match(grant.reason, /completed captures/);
});

test("an empty or malformed PayPal reply grants nothing", () => {
  for (const payload of [null, {}, { id: "x" }, { purchase_units: [] }]) {
    assert.equal(resolveGrant(normaliseOrder(payload)).ok, false);
  }
  assert.equal(resolveGrant(null).ok, false);
});

// -----------------------------------------------------------------------------
// Reading PayPal's replies
// -----------------------------------------------------------------------------

test("the captured amount is read from the capture, not from what was asked for", () => {
  // PayPal reports both: purchase_units[0].amount is the requested amount and
  // the capture is what was actually taken. Only the capture is money.
  const order = normaliseOrder({
    id: "ORDER1",
    status: "COMPLETED",
    purchase_units: [
      {
        amount: { currency_code: "USD", value: "25.00" },
        payments: {
          captures: [
            {
              id: "CAPTURE1",
              status: "COMPLETED",
              amount: { currency_code: "USD", value: "5.00" },
            },
          ],
        },
      },
    ],
  });

  assert.equal(order.amount, "5.00");
  assert.equal(resolveGrant(order).credits, 20);
});

test("sandbox is the default, and only the exact string 'live' selects live", () => {
  const original = process.env.PAYPAL_ENV;
  try {
    for (const value of [undefined, "", "sandbox", "SANDBOX", "production", "prod", "yes"]) {
      if (value === undefined) delete process.env.PAYPAL_ENV;
      else process.env.PAYPAL_ENV = value;
      assert.equal(
        paypalBaseUrl(),
        "https://api-m.sandbox.paypal.com",
        `${String(value)} must not select the live API`
      );
    }
    for (const value of ["live", "LIVE", " live "]) {
      process.env.PAYPAL_ENV = value;
      assert.equal(paypalBaseUrl(), "https://api-m.paypal.com");
    }
  } finally {
    if (original === undefined) delete process.env.PAYPAL_ENV;
    else process.env.PAYPAL_ENV = original;
  }
});

// -----------------------------------------------------------------------------
// Spending
// -----------------------------------------------------------------------------

test("an unreadable balance does not buy anything", () => {
  // The generation endpoint reads the balance before calling the model. A null
  // balance means the profile row could not be read, which must not be treated
  // as credit.
  assert.equal(canSpendCredit(null), false);
  assert.equal(canSpendCredit(undefined), false);
  assert.equal(canSpendCredit("5"), false);
  assert.equal(canSpendCredit(NaN), false);
  assert.equal(canSpendCredit(0), false);
  assert.equal(canSpendCredit(-1), false);
  assert.equal(canSpendCredit(1), true);
});
