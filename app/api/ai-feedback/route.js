/**
 * Builds the end-of-interview report.
 *
 * This route used to accept the answers — questions, transcripts and scores —
 * in the request body, and do arithmetic over them. Since the interview flow is
 * deliberately anonymous, that meant anybody holding an invite link could POST
 * a set of tens and a name, never call the scoring endpoint at all, and land a
 * 10/10 report card with attacker-authored text on the recruiter's dashboard.
 *
 * `lib/score.js` describes its arithmetic as deterministic, and it is. That was
 * never the property under attack: determinism is not provenance, and
 * arithmetic over numbers the candidate chose is reliably wrong.
 *
 * The request now carries a session token and nothing else. The questions come
 * from the interview, the scores come from the rows /api/score-answer wrote
 * when it issued them, and the candidate's name comes from the session created
 * when they joined.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { SUMMARY_PROMPT, fillTemplate } from "@/lib/prompts";
import { summarySchema } from "@/lib/schemas";
import { aggregateScores } from "@/lib/score";
import { buildPerQuestion, describeScores } from "@/lib/report";
import { GENERATION_LIMIT, rateLimitKey } from "@/lib/rateLimit";
import { isUuidV4 } from "@/lib/tokens";
import { completeStructured } from "@/lib/server/llm";
import { saveFeedback } from "@/lib/server/interviews";
import {
  findSessionWithInterview,
  listAnswerScores,
  markSessionSubmitted,
} from "@/lib/server/sessions";
import { jsonError } from "@/lib/server/http";
import {
  consumeRateLimit,
  rateLimitHeaders,
  RateLimitUnavailableError,
} from "@/lib/server/rateLimit";
import { MissingConfigError } from "@/lib/server/env";

const requestSchema = z.object({
  sessionToken: z.string().trim(),
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
    return jsonError(400, "Provide the interview session token.");
  }

  if (!isUuidV4(body.sessionToken)) {
    return jsonError(404, "That interview session is not valid.");
  }

  // Keyed on the session, so one candidate cannot exhaust another's budget.
  let decision;
  try {
    decision = await consumeRateLimit(
      rateLimitKey("ai-feedback", body.sessionToken),
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
      `This session has used its report budget for the hour. Try again in ${decision.retryAfterSeconds} seconds.`,
      headers
    );
  }

  const found = await findSessionWithInterview(body.sessionToken);
  if (!found) {
    return jsonError(404, "That interview session is not valid.", headers);
  }
  const { session, interview } = found;

  // A resubmitted session is answered from what was already filed, without a
  // second report row and without spending another model call.
  if (session.submitted_at) {
    return NextResponse.json({ saved: true, alreadySubmitted: true }, { headers });
  }

  const scores = await listAnswerScores(session.session_token);
  const perQuestion = buildPerQuestion(interview.questionList, scores);
  const { answered, overall, rating } = aggregateScores(perQuestion);

  let summary = UNAVAILABLE_SUMMARY;
  let summaryGenerated = false;

  try {
    summary = await completeStructured({
      system: SYSTEM,
      prompt: fillTemplate(SUMMARY_PROMPT, {
        jobPosition: interview.jobPosition ?? "the role",
        scoredAnswers: describeScores(perQuestion),
      }),
      schema: summarySchema,
    });
    summaryGenerated = true;
  } catch (error) {
    // A missing summary must not cost the candidate their scored report.
    console.error("[ai-feedback] summary unavailable:", error.message);
  }

  const report = {
    version: 3,
    summaryGenerated,
    answered,
    overall,
    perQuestion,
    feedback: {
      rating,
      summary: summary.summary,
      recommendation: summary.recommendation,
      recommendationMsg: summary.recommendationMsg,
    },
  };

  try {
    await saveFeedback({
      interviewId: session.interview_id,
      userName: session.user_name,
      userEmail: session.user_email ?? "",
      feedback: report,
    });
    await markSessionSubmitted(session.session_token);
  } catch (error) {
    console.error("[ai-feedback] could not store the report:", error.message);
    return jsonError(500, "Your answers could not be saved.", headers);
  }

  return NextResponse.json({ ...report, saved: true }, { headers });
}
