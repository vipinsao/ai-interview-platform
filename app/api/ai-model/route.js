/**
 * Interview question generation.
 *
 * Requires a signed-in recruiter and is rate limited per user: this endpoint
 * spends the project's LLM budget, and before those two checks existed anyone
 * on the internet could call it in a loop.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { QUESTIONS_PROMPT, fillTemplate } from "@/lib/prompts";
import { questionListSchema } from "@/lib/schemas";
import { GENERATION_LIMIT, rateLimitKey } from "@/lib/rateLimit";
import { canSpendCredit } from "@/lib/credits";
import { getUserFromRequest } from "@/lib/server/auth";
import { creditsFor } from "@/lib/server/credits";
import { completeStructured, StructuredOutputError } from "@/lib/server/llm";
import { MissingConfigError } from "@/lib/server/env";
import { jsonError } from "@/lib/server/http";
import {
  consumeRateLimit,
  rateLimitHeaders,
  RateLimitUnavailableError,
} from "@/lib/server/rateLimit";

const requestSchema = z.object({
  jobPosition: z.string().trim().min(1).max(200),
  jobDescription: z.string().trim().min(1).max(5000),
  duration: z.string().trim().min(1).max(50),
  type: z.union([z.string(), z.array(z.string())]),
});

const SYSTEM =
  "You write interview questions. You reply with JSON only and never with commentary.";

export async function POST(request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return jsonError(401, "Sign in to generate interview questions.");
  }

  let body;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Provide jobPosition, jobDescription, duration and type."
    );
  }

  let decision;
  try {
    decision = await consumeRateLimit(
      rateLimitKey("ai-model", user.id),
      GENERATION_LIMIT
    );
  } catch (error) {
    if (
      error instanceof RateLimitUnavailableError ||
      error instanceof MissingConfigError
    ) {
      console.error("[ai-model] rate limiting unavailable:", error.message);
      return jsonError(503, "Question generation is temporarily unavailable.");
    }
    throw error;
  }

  const headers = rateLimitHeaders(decision, GENERATION_LIMIT.limit);
  if (!decision.allowed) {
    return jsonError(
      429,
      `You have used all ${GENERATION_LIMIT.limit} question generations for this hour. Try again in ${decision.retryAfterSeconds} seconds.`,
      headers
    );
  }

  // The only credit check used to be in the browser, on the page before this
  // one, so a recruiter with an empty balance could still spend the project's
  // LLM budget by calling this endpoint directly. The balance is now read
  // server-side, with the service-role key, before any model call.
  let credits;
  try {
    credits = await creditsFor(user.email);
  } catch (error) {
    console.error("[ai-model] could not read the credit balance:", error.message);
    return jsonError(503, "Question generation is temporarily unavailable.", headers);
  }

  if (!canSpendCredit(credits)) {
    return jsonError(
      402,
      "You have no interview credits left. Buy more on the billing page.",
      headers
    );
  }

  const prompt = fillTemplate(QUESTIONS_PROMPT, {
    jobTitle: body.jobPosition,
    jobDescription: body.jobDescription,
    duration: body.duration,
    type: Array.isArray(body.type) ? body.type.join(", ") : body.type,
  });

  try {
    const result = await completeStructured({
      system: SYSTEM,
      prompt,
      schema: questionListSchema,
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error("[ai-model]", error.message);
      return jsonError(503, "Question generation is not configured.", headers);
    }
    if (error instanceof StructuredOutputError) {
      console.error("[ai-model]", error.message);
      return jsonError(
        502,
        "The model did not return usable questions. Please try again.",
        headers
      );
    }
    console.error("[ai-model] unexpected failure:", error);
    return jsonError(502, "Question generation failed. Please try again.", headers);
  }
}
