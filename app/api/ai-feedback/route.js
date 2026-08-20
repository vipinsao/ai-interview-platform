/**
 * Builds the end-of-interview report from answers that have already been
 * scored one by one.
 *
 * The numbers are computed here in JavaScript (lib/score.js), not asked of the
 * model: the same answers must always produce the same rating, and a recruiter
 * has to be able to trace a figure back to the answers behind it. Only the
 * prose summary is generated, and if that call fails the report is still
 * returned with its ratings intact.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { SUMMARY_PROMPT, fillTemplate } from "@/lib/prompts";
import { summarySchema } from "@/lib/schemas";
import { aggregateScores } from "@/lib/score";
import { GENERATION_LIMIT, rateLimitKey } from "@/lib/rateLimit";
import { completeStructured } from "@/lib/server/llm";
import { findInterview, saveFeedback } from "@/lib/server/interviews";
import { jsonError } from "@/lib/server/http";
import {
  consumeRateLimit,
  rateLimitHeaders,
  RateLimitUnavailableError,
} from "@/lib/server/rateLimit";
import { MissingConfigError } from "@/lib/server/env";

const answerSchema = z.object({
  question: z.string().max(2000).default(""),
  type: z.string().max(100).default(""),
  transcript: z.string().max(20000).default(""),
  score: z.number().min(0).max(10).nullable().default(null),
  strengths: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  suggestedImprovement: z.string().default(""),
});

const requestSchema = z.object({
  interview_id: z.string().trim().min(1).max(100),
  userName: z.string().trim().min(1).max(200),
  userEmail: z.string().trim().max(320).default(""),
  answers: z.array(answerSchema).min(1).max(50),
});

const SYSTEM =
  "You summarise interviews. You reply with JSON only and never with commentary.";

const UNAVAILABLE_SUMMARY = {
  summary:
    "An automated written summary could not be generated for this interview. The ratings below are computed directly from the per-answer scores.",
  recommendation: "Maybe",
  recommendationMsg:
    "Review the per-question scores and transcripts before deciding.",
};

export async function POST(request) {
  let body;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return jsonError(
      400,
      "Provide interview_id, userName and a non-empty answers array."
    );
  }

  const interview = await findInterview(body.interview_id);
  if (!interview) {
    return jsonError(404, "That interview link is not valid.");
  }

  let decision;
  try {
    decision = await consumeRateLimit(
      rateLimitKey("ai-feedback", body.interview_id),
      GENERATION_LIMIT
    );
  } catch (error) {
    if (
      error instanceof RateLimitUnavailableError ||
      error instanceof MissingConfigError
    ) {
      console.error("[ai-feedback] rate limiting unavailable:", error.message);
      return jsonError(503, "Report generation is temporarily unavailable.");
    }
    throw error;
  }

  const headers = rateLimitHeaders(decision, GENERATION_LIMIT.limit);
  if (!decision.allowed) {
    return jsonError(
      429,
      `This interview has used its report budget for the hour. Try again in ${decision.retryAfterSeconds} seconds.`,
      headers
    );
  }

  const { answered, overall, rating } = aggregateScores(body.answers);

  const scoredAnswers = body.answers
    .map(
      (answer, index) =>
        `${index + 1}. [${answer.type || "General"}] ${answer.question}\n   score: ${
          answer.score === null ? "not scored" : `${answer.score}/10`
        }`
    )
    .join("\n");

  let summary = UNAVAILABLE_SUMMARY;
  let summaryGenerated = false;

  try {
    summary = await completeStructured({
      system: SYSTEM,
      prompt: fillTemplate(SUMMARY_PROMPT, {
        jobPosition: interview.jobPosition ?? "the role",
        scoredAnswers,
      }),
      schema: summarySchema,
    });
    summaryGenerated = true;
  } catch (error) {
    // A missing summary must not cost the candidate their scored report.
    console.error("[ai-feedback] summary unavailable:", error.message);
  }

  const report = {
    version: 2,
    summaryGenerated,
    answered,
    overall,
    perQuestion: body.answers,
    feedback: {
      rating,
      summary: summary.summary,
      recommendation: summary.recommendation,
      recommendationMsg: summary.recommendationMsg,
    },
  };

  // Written here rather than from the browser so anonymous clients need no
  // write access to the table, and so a report can only be filed against an
  // interview that exists.
  try {
    await saveFeedback({
      interviewId: body.interview_id,
      userName: body.userName,
      userEmail: body.userEmail,
      feedback: report,
    });
  } catch (error) {
    console.error("[ai-feedback] could not store the report:", error.message);
    return jsonError(500, "Your answers could not be saved.", headers);
  }

  return NextResponse.json({ ...report, saved: true }, { headers });
}
