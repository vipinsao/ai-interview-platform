/**
 * Deciding whether a PayPal order has earned any credits.
 *
 * Pure: it is handed the normalised order PayPal returned and answers yes or
 * no. Nothing here reads the request, so none of these checks can be satisfied
 * by anything the browser sent. That is the point — the previous
 * implementation added credits from `onApprove` in the browser, which meant
 * "was this paid for" was a question the payer answered themselves.
 */
import { CREDIT_PLANS, PLAN_CURRENCY, planForCents, toCents } from "./plans.js";

function refuse(reason) {
  return { ok: false, reason };
}

/**
 * @param {object|null} order  the shape returned by normaliseOrder() in lib/server/paypal.js
 * @param {Array} plans
 * @returns {{ok: true, credits: number, planId: string, amountCents: number}
 *          |{ok: false, reason: string}}
 */
export function resolveGrant(order, plans = CREDIT_PLANS) {
  if (!order) return refuse("PayPal returned no order");

  if (order.status !== "COMPLETED") {
    return refuse(
      `the order is ${order.status ?? "in an unknown state"}, not COMPLETED`
    );
  }

  // More than one purchase unit would mean more than one amount, and there is
  // no sensible way to decide which one bought the credits.
  if (order.purchaseUnitCount !== 1) {
    return refuse(
      `the order has ${order.purchaseUnitCount} purchase units, expected exactly 1`
    );
  }

  if (order.completedCaptureCount !== 1) {
    return refuse(
      `the order has ${order.completedCaptureCount} completed captures, expected exactly 1`
    );
  }

  if (order.currency !== PLAN_CURRENCY) {
    return refuse(
      `the order is in ${order.currency ?? "no currency"}, and plans are priced in ${PLAN_CURRENCY}`
    );
  }

  const cents = toCents(order.amount);
  if (cents === null) return refuse("the captured amount is not a usable number");

  const plan = planForCents(cents, plans);
  if (!plan) return refuse(`no plan is sold for ${order.amount} ${order.currency}`);

  return { ok: true, credits: plan.credits, planId: plan.id, amountCents: cents };
}

/**
 * Whether a balance permits spending the project's LLM budget.
 *
 * `null` means the profile row could not be read, which is not the same as
 * "plenty" — an unreadable balance must not buy anything. Question generation
 * is the endpoint that costs real money, and until now it checked nothing: the
 * only credit check in the app was in the browser, on the page before it.
 */
export function canSpendCredit(credits) {
  return typeof credits === "number" && Number.isFinite(credits) && credits > 0;
}
