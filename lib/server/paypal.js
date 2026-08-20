/**
 * The one place the app talks to PayPal.
 *
 * Nothing the browser sends is trusted. The client hands over an order id; this
 * module asks PayPal what that order actually is, and the answer — status,
 * currency, captured amount — is the only input to whether credits are granted.
 *
 * Sandbox is the default and `PAYPAL_ENV=live` is the only value that selects
 * the live API, so a typo cannot silently start taking real money. The opposite
 * mistake fails safe: a live order id does not exist in sandbox, so the capture
 * 404s and no credits are granted.
 */
import { MissingConfigError, requireEnv } from "./env.js";

const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
const LIVE_BASE_URL = "https://api-m.paypal.com";
const REQUEST_TIMEOUT_MS = 15_000;

export class PayPalError extends Error {
  constructor(message, { status = null, issue = null } = {}) {
    super(message);
    this.name = "PayPalError";
    this.status = status;
    this.issue = issue;
  }
}

export function paypalBaseUrl() {
  return process.env.PAYPAL_ENV?.trim().toLowerCase() === "live"
    ? LIVE_BASE_URL
    : SANDBOX_BASE_URL;
}

/**
 * The fields the rest of the app is allowed to care about, pulled out of
 * PayPal's response shape. Exported so the checks in lib/credits.js can be
 * tested against recorded payloads without a network.
 */
export function normaliseOrder(payload) {
  const units = Array.isArray(payload?.purchase_units) ? payload.purchase_units : [];
  const captures = Array.isArray(units[0]?.payments?.captures)
    ? units[0].payments.captures
    : [];
  const completed = captures.filter((capture) => capture?.status === "COMPLETED");
  // The captured amount is the money PayPal actually took. The purchase unit's
  // own amount is only what was asked for, which is not the same thing.
  const money = completed[0]?.amount ?? null;

  return {
    orderId: payload?.id ?? null,
    status: payload?.status ?? null,
    purchaseUnitCount: units.length,
    completedCaptureCount: completed.length,
    captureId: completed[0]?.id ?? null,
    amount: money?.value ?? null,
    currency: money?.currency_code ?? null,
  };
}

let cachedToken = null;

async function accessToken(baseUrl) {
  const clientId = requireEnv(
    "PAYPAL_CLIENT_ID",
    "Create a free sandbox app at https://developer.paypal.com/dashboard/applications."
  );
  const clientSecret = requireEnv(
    "PAYPAL_CLIENT_SECRET",
    "It is on the same PayPal app page as the client id. Server only."
  );

  const scope = `${baseUrl}:${clientId}`;
  if (cachedToken?.scope === scope && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new PayPalError("could not authenticate with PayPal", {
      status: response.status,
      issue: payload?.error ?? null,
    });
  }

  cachedToken = {
    scope,
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in ?? 0) * 1000,
  };
  return cachedToken.token;
}

async function readOrder(baseUrl, token, orderId) {
  const response = await fetch(
    `${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PayPalError("PayPal would not describe that order", {
      status: response.status,
      issue: payload?.details?.[0]?.issue ?? null,
    });
  }
  return normaliseOrder(payload);
}

/**
 * Capture an order and report what PayPal says it is.
 *
 * The capture is sent with PayPal-Request-Id set to the order id, which is
 * PayPal's own idempotency key: a retried request returns the original capture
 * rather than taking the money twice. When an order was already captured — by
 * a retry, or by someone replaying the id — PayPal answers 422
 * ORDER_ALREADY_CAPTURED, and the order is read back instead so the caller
 * still learns the real amount. Granting is made idempotent separately, in the
 * database, because that is the guarantee that must not depend on a vendor.
 */
export function createPayPalClient() {
  const baseUrl = paypalBaseUrl();

  return {
    baseUrl,
    async captureOrder(orderId) {
      const token = await accessToken(baseUrl);

      const response = await fetch(
        `${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": `capture:${orderId}`,
          },
          body: "{}",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      );

      const payload = await response.json().catch(() => null);
      if (response.ok) return normaliseOrder(payload);

      const issue = payload?.details?.[0]?.issue ?? null;
      if (response.status === 422 && issue === "ORDER_ALREADY_CAPTURED") {
        return readOrder(baseUrl, token, orderId);
      }

      throw new PayPalError(
        issue ? `PayPal refused the capture: ${issue}` : "PayPal refused the capture",
        { status: response.status, issue }
      );
    },
  };
}

export { MissingConfigError };
