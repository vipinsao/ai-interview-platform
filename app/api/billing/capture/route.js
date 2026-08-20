/**
 * Turns a paid PayPal order into credits.
 *
 * This endpoint exists because the browser used to do this job. PayButton's
 * onApprove handler ran an UPDATE on the Users table adding credits, which
 * meant the only thing standing between a visitor and unlimited credits was
 * their willingness to open the developer console. Nothing verified that a
 * payment had happened, and the amount was whichever number the client held.
 *
 * Now the client sends one thing — an order id — and every fact that decides
 * the outcome comes from PayPal or from the verified session.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { BILLING_LIMIT, rateLimitKey } from "@/lib/rateLimit";
import { getUserFromRequest } from "@/lib/server/auth";
import {
  PURCHASE_OUTCOME,
  processCreditPurchase,
  supabaseCreditStore,
} from "@/lib/server/credits";
import { MissingConfigError } from "@/lib/server/env";
import { jsonError } from "@/lib/server/http";
import { createPayPalClient, PayPalError } from "@/lib/server/paypal";
import {
  consumeRateLimit,
  rateLimitHeaders,
  RateLimitUnavailableError,
} from "@/lib/server/rateLimit";

// PayPal order ids are short uppercase alphanumeric strings. Constraining the
// shape keeps obvious junk away from the PayPal call entirely.
const requestSchema = z.object({
  orderId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{6,32}$/, "not a PayPal order id"),
});

export async function POST(request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return jsonError(401, "Sign in before buying credits.");
  }

  let body;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return jsonError(400, "Provide the PayPal order id.");
  }

  // Rate limited per user: without it this is an oracle for guessing order ids.
  let decision;
  try {
    decision = await consumeRateLimit(
      rateLimitKey("billing-capture", user.id),
      BILLING_LIMIT
    );
  } catch (error) {
    if (
      error instanceof RateLimitUnavailableError ||
      error instanceof MissingConfigError
    ) {
      console.error("[billing] rate limiting unavailable:", error.message);
      return jsonError(503, "Credit purchases are temporarily unavailable.");
    }
    throw error;
  }

  const headers = rateLimitHeaders(decision, BILLING_LIMIT.limit);
  if (!decision.allowed) {
    return jsonError(
      429,
      `Too many purchase attempts. Try again in ${decision.retryAfterSeconds} seconds.`,
      headers
    );
  }

  let result;
  try {
    result = await processCreditPurchase({
      orderId: body.orderId,
      userEmail: user.email,
      paypal: createPayPalClient(),
      store: supabaseCreditStore(),
    });
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error("[billing]", error.message);
      return jsonError(503, "Credit purchases are not configured.", headers);
    }
    if (error instanceof PayPalError) {
      console.error("[billing] PayPal:", error.status, error.message);
      if (error.status === 404) {
        return jsonError(404, "PayPal does not recognise that payment.", headers);
      }
      return jsonError(502, "PayPal could not confirm that payment.", headers);
    }
    console.error("[billing] unexpected failure:", error);
    return jsonError(500, "Your payment could not be completed.", headers);
  }

  switch (result.outcome) {
    case PURCHASE_OUTCOME.granted:
      return NextResponse.json(
        { credits: result.credits, creditsTotal: result.creditsTotal, alreadyGranted: false },
        { headers }
      );

    case PURCHASE_OUTCOME.alreadyGranted:
      // Not an error: a retried or double-submitted capture is expected, and
      // the honest answer is that the credits are already on the account.
      return NextResponse.json(
        { credits: result.credits, creditsTotal: result.creditsTotal, alreadyGranted: true },
        { headers }
      );

    case PURCHASE_OUTCOME.notYours:
      return jsonError(403, "That payment belongs to another account.", headers);

    default:
      console.warn("[billing] refused a capture:", result.reason);
      return jsonError(402, "That payment was not completed.", headers);
  }
}
