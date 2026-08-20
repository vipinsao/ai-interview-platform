/**
 * The credit plans, defined once and used by both sides.
 *
 * The billing page renders these, and the server resolves a verified PayPal
 * payment back to a plan through them. Keeping one list is what makes it safe
 * for the browser to create the PayPal order: whatever amount the client asks
 * for, the server grants credits only for the amount PayPal says was actually
 * captured, matched against this table.
 *
 * Prices are matched exactly, so two plans must never share a price. That is
 * asserted in tests/plans.test.js rather than left to good manners.
 */
export const CREDIT_PLANS = [
  {
    id: "basic",
    name: "Basic",
    price: "5.00",
    credits: 20,
    features: ["Basic interview templates", "Email support"],
  },
  {
    id: "standard",
    name: "Standard",
    price: "12.00",
    credits: 50,
    features: ["All interview templates", "Priority support", "Basic analytics"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "25.00",
    credits: 120,
    features: ["All interview templates", "24/7 support", "Advanced analytics"],
  },
];

export const PLAN_CURRENCY = "USD";

/**
 * Money as an integer number of cents. Prices are compared as integers because
 * "5.00" and 5.001 must not be the same payment, and floating point subtraction
 * of decimal strings is not a comparison anyone should have to reason about.
 *
 * @returns {number|null} null when the value is not a plain decimal amount
 */
export function toCents(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

export function planForCents(cents, plans = CREDIT_PLANS) {
  if (cents === null) return null;
  return plans.find((plan) => toCents(plan.price) === cents) ?? null;
}
