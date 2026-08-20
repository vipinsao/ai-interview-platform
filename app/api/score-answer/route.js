/**
 * Scores a single interview answer.
 *
 * Called by the candidate, who is not signed in, so the request is
 * authenticated by the interview id in the shareable link: the interview must
 * exist, and the rate limit budget is that interview's.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { ANSWER_SCORE_PROMPT, fillTemplate } from "@/lib/prompts";
import { answerScoreSchema } from "@/lib/schemas";
import { SCORING_LIMIT, rateLimitKey } from "@/lib/rateLimit";
import { completeStructured, StructuredOutputError } from "@/lib/server/llm";
import { MissingConfigError } from "@/lib/server/env";
import { findInterview } from "@/lib/server/interviews";
import { jsonError } from "@/lib/server/http";
import {
  consumeRateLimit,
  rateLimitHeaders,
  RateLimitUnavailableError,
} from "@/lib/server/rateLimit";

const requestSchema = z.object({
  interview_id: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(2000),
  questionType: z.string().trim().max(100).default("Technical"),
  answer: z.string().max(20000),
});

const SYSTEM =
  "You are a strict but fair interview assessor. You reply with JSON only and never with commentary.";

export async function POST(request) {
  let body;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return jsonError(400, "Provide interview_id, question and answer.");
  }

  const interview = await findInterview(body.interview_id);
  if (!interview) {
    return jsonError(404, "That interview link is not valid.");
  }

  let decision;
  try {
    decision = await consumeRateLimit(
      rateLimitKey("score-answer", body.interview_id),
      SCORING_LIMIT
    );
  } catch (error) {
    if (
      error instanceof RateLimitUnavailableError ||
      error instanceof MissingConfigError
    ) {
      console.error("[score-answer] rate limiting unavailable:", error.message);
      return jsonError(503, "Scoring is temporarily unavailable.");
    }
    throw error;
  }

  const headers = rateLimitHeaders(decision, SCORING_LIMIT.limit);
  if (!decision.allowed) {
    return jsonError(
      429,
      `This interview has used its scoring budget for the hour. Try again in ${decision.retryAfterSeconds} seconds.`,
      headers
    );
  }

  const prompt = fillTemplate(ANSWER_SCORE_PROMPT, {
    jobPosition: interview.jobPosition ?? "the role",
    questionType: body.questionType,
    question: body.question,
    answer: body.answer.trim() === "" ? "(no answer given)" : body.answer,
  });

  try {
    const score = await completeStructured({
      system: SYSTEM,
      prompt,
      schema: answerScoreSchema,
    });
    return NextResponse.json(score, { headers });
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error("[score-answer]", error.message);
      return jsonError(503, "Scoring is not configured.", headers);
    }
    if (error instanceof StructuredOutputError) {
      console.error("[score-answer]", error.message);
      return jsonError(502, "This answer could not be scored.", headers);
    }
    console.error("[score-answer] unexpected failure:", error);
    return jsonError(502, "This answer could not be scored.", headers);
  }
}
