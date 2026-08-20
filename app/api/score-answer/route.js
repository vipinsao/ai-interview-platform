/**
 * Scores a single interview answer, and records the score it issued.
 *
 * Two things about this endpoint used to be wrong, and they compounded.
 *
 * The caller supplied the question text, which was never checked against the
 * interview's own question list. That made this an unauthenticated proxy to the
 * project's language model with an attacker-controlled prompt — `fillTemplate`
 * is plain substitution with no escaping, and the question is interpolated
 * above the scoring criteria, so injected text reads as prompt structure. The
 * question now comes from the stored questionList by index; the request carries
 * an integer, and there is no way to put words into the prompt.
 *
 * And the score was only ever returned to the browser, which meant the browser
 * was where it lived until the end of the interview — so the report could be
 * built without this endpoint being called at all. Scores are now written to
 * answer_scores as they are issued, and the report is assembled from those rows.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { ANSWER_SCORE_PROMPT, fillTemplate } from "@/lib/prompts";
import { answerScoreSchema } from "@/lib/schemas";
import { SCORING_LIMIT, rateLimitKey } from "@/lib/rateLimit";
import { isUuidV4 } from "@/lib/tokens";
import { completeStructured, StructuredOutputError } from "@/lib/server/llm";
import { MissingConfigError } from "@/lib/server/env";
import { jsonError } from "@/lib/server/http";
import { findSessionWithInterview, recordAnswerScore } from "@/lib/server/sessions";
import {
  consumeRateLimit,
  rateLimitHeaders,
  RateLimitUnavailableError,
} from "@/lib/server/rateLimit";

const requestSchema = z.object({
  sessionToken: z.string().trim(),
  // An index, not a question. This is the whole of the prompt-injection fix.
  questionIndex: z.number().int().min(0).max(99),
  answer: z.string().max(20000),
});

const SYSTEM =
  "You are a strict but fair interview assessor. You reply with JSON only and never with commentary.";

export async function POST(request) {
  let body;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return jsonError(400, "Provide sessionToken, questionIndex and answer.");
  }

  // Checked before anything else touches a database or a model.
  if (!isUuidV4(body.sessionToken)) {
    return jsonError(404, "That interview session is not valid.");
  }

  // The limit is consumed before the session is looked up, so an unknown token
  // cannot be used to make unmetered database reads.
  let decision;
  try {
    decision = await consumeRateLimit(
      rateLimitKey("score-answer", body.sessionToken),
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
      `This session has used its scoring budget for the hour. Try again in ${decision.retryAfterSeconds} seconds.`,
      headers
    );
  }

  const found = await findSessionWithInterview(body.sessionToken);
  if (!found) {
    return jsonError(404, "That interview session is not valid.", headers);
  }

  const { session, interview } = found;
  const questions = Array.isArray(interview.questionList) ? interview.questionList : [];
  const asked = questions[body.questionIndex];
  if (!asked) {
    return jsonError(400, "That question is not part of this interview.", headers);
  }

  // Both taken from the interview, never from the request.
  const question = String(asked.question ?? "");
  const questionType = String(asked.type ?? "Technical");

  const prompt = fillTemplate(ANSWER_SCORE_PROMPT, {
    jobPosition: interview.jobPosition ?? "the role",
    questionType,
    question,
    answer: body.answer.trim() === "" ? "(no answer given)" : body.answer,
  });

  let score = null;
  try {
    score = await completeStructured({
      system: SYSTEM,
      prompt,
      schema: answerScoreSchema,
    });
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error("[score-answer]", error.message);
      return jsonError(503, "Scoring is not configured.", headers);
    }
    if (!(error instanceof StructuredOutputError)) {
      console.error("[score-answer] unexpected failure:", error);
    } else {
      console.error("[score-answer]", error.message);
    }

    // The answer is recorded unscored rather than lost. A scoring outage must
    // not delete the candidate's work, and it must not read as a zero — the
    // report shows the transcript and says it could not be scored.
    try {
      await recordAnswerScore({
        sessionToken: session.session_token,
        questionIndex: body.questionIndex,
        question,
        questionType,
        transcript: body.answer,
        score: null,
        strengths: [],
        gaps: [],
        suggestedImprovement: "",
      });
    } catch (writeError) {
      console.error("[score-answer] could not record the answer:", writeError.message);
    }
    return jsonError(502, "This answer could not be scored.", headers);
  }

  let recorded;
  try {
    recorded = await recordAnswerScore({
      sessionToken: session.session_token,
      questionIndex: body.questionIndex,
      question,
      questionType,
      transcript: body.answer,
      score: score.score,
      strengths: score.strengths,
      gaps: score.gaps,
      suggestedImprovement: score.suggestedImprovement,
    });
  } catch (error) {
    console.error("[score-answer] could not record the score:", error.message);
    return jsonError(500, "This answer could not be saved.", headers);
  }

  // A question that already carried a score keeps it, so the figure returned is
  // the stored one rather than the one just produced. Otherwise an answer could
  // be resubmitted until the model happened to return a ten.
  return NextResponse.json(
    {
      score: recorded.recorded ? score.score : Number(recorded.finalScore),
      strengths: recorded.recorded ? score.strengths : [],
      gaps: recorded.recorded ? score.gaps : [],
      suggestedImprovement: recorded.recorded ? score.suggestedImprovement : "",
      alreadyScored: !recorded.recorded,
    },
    { headers }
  );
}
