/**
 * Granting credits for a PayPal payment.
 *
 * The flow is written against two injected collaborators — a PayPal client and
 * a store — so the whole decision path can be tested without a network or a
 * database (tests/credits.test.js). The route handler is only an adapter.
 *
 * Two rules hold everything up:
 *
 *   1. The amount is whatever PayPal says was captured. Nothing the browser
 *      sends is an input to how many credits are granted; the client supplies
 *      an order id and the identity comes from the verified JWT.
 *   2. Granting is idempotent on the PayPal order id, enforced by a primary key
 *      in Postgres rather than by a check in JavaScript. A replay loses the
 *      insert race and adds nothing.
 */
import { resolveGrant } from "../credits.js";
import { serverAdminClient } from "./supabase.js";

export const PURCHASE_OUTCOME = {
  granted: "granted",
  alreadyGranted: "already-granted",
  refused: "refused",
  notYours: "not-yours",
};

/**
 * @param {object} args
 * @param {string} args.orderId
 * @param {string} args.userEmail  from the verified JWT, never from the body
 * @param {{captureOrder: (orderId: string) => Promise<object>}} args.paypal
 * @param {object} args.store
 */
export async function processCreditPurchase({ orderId, userEmail, paypal, store }) {
  // Cheap path for the common replay — a double click, or a retried request.
  // Not the guarantee: two simultaneous first attempts both find nothing here,
  // and are separated by the unique index below.
  const recorded = await store.findPurchase(orderId);
  if (recorded) {
    return settleExisting(recorded, userEmail, store);
  }

  const order = await paypal.captureOrder(orderId);
  const grant = resolveGrant(order);
  if (!grant.ok) {
    return { outcome: PURCHASE_OUTCOME.refused, reason: grant.reason };
  }

  const { granted, creditsTotal } = await store.grantCredits({
    orderId,
    userEmail,
    credits: grant.credits,
    amount: order.amount,
    currency: order.currency,
    captureId: order.captureId,
  });

  if (!granted) {
    // Lost the race to a concurrent request for the same order id.
    const existing = await store.findPurchase(orderId);
    return settleExisting(existing, userEmail, store);
  }

  return {
    outcome: PURCHASE_OUTCOME.granted,
    credits: grant.credits,
    creditsTotal,
  };
}

async function settleExisting(recorded, userEmail, store) {
  if (!recorded) {
    return {
      outcome: PURCHASE_OUTCOME.refused,
      reason: "the payment could not be recorded",
    };
  }
  // Someone replaying another account's order id learns nothing and gets
  // nothing. The credits went to whoever the order was captured for.
  if (recorded.user_email !== userEmail) {
    return { outcome: PURCHASE_OUTCOME.notYours };
  }
  return {
    outcome: PURCHASE_OUTCOME.alreadyGranted,
    credits: recorded.credits_granted,
    creditsTotal: await store.creditsFor(userEmail),
  };
}

/**
 * A user's credit balance, read with the service-role key.
 *
 * @returns {Promise<number|null>} null when there is no profile row
 */
export async function creditsFor(userEmail, db = serverAdminClient()) {
  const { data, error } = await db
    .from("Users")
    .select("credits")
    .eq("email", userEmail)
    .maybeSingle();
  if (error) throw new Error(`credit balance lookup failed: ${error.message}`);
  return data?.credits ?? null;
}

/** The real store: the service-role key, because clients may not write credits. */
export function supabaseCreditStore(db = serverAdminClient()) {
  return {
    async findPurchase(orderId) {
      const { data, error } = await db
        .from("credit_purchases")
        .select("paypal_order_id, user_email, credits_granted")
        .eq("paypal_order_id", orderId)
        .maybeSingle();
      if (error) throw new Error(`credit ledger lookup failed: ${error.message}`);
      return data ?? null;
    },

    async grantCredits({ orderId, userEmail, credits, amount, currency, captureId }) {
      const { data, error } = await db.rpc("grant_purchased_credits", {
        p_order_id: orderId,
        p_user_email: userEmail,
        p_credits: credits,
        p_amount: amount,
        p_currency: currency,
        p_capture_id: captureId,
      });
      if (error) throw new Error(`granting credits failed: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      return { granted: row?.granted === true, creditsTotal: row?.credits_total ?? null };
    },

    creditsFor(userEmail) {
      return creditsFor(userEmail, db);
    },
  };
}
