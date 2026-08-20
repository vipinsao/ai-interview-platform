/**
 * Starts a candidate's interview session.
 *
 * This is where an anonymous candidate acquires an identity. Before it existed,
 * every request a candidate made was identified only by the interview id — which
 * every other candidate holding the same invite link also has — so requests from
 * different people were indistinguishable, they shared one rate limit budget,
 * and no score could be tied to the person it was issued to.
 *
 * The question list is handed over here rather than by the GET route, so the
 * questions are released when somebody actually starts, against a session that
 * is recorded and rate limited, instead of to anybody who curls the link.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { SESSION_LIMIT, rateLimitKey } from "@/lib/rateLimit";
import { MissingConfigError } from "@/lib/server/env";
import { jsonError } from "@/lib/server/http";
import { findInterview } from "@/lib/server/interviews";
import { createSession } from "@/lib/server/sessions";
import {
  consumeRateLimit,
  rateLimitHeaders,
  RateLimitUnavailableError,
} from "@/lib/server/rateLimit";

const requestSchema = z.object({
  userName: z.string().trim().min(1).max(200),
  userEmail: z.string().trim().max(320).default(""),
});

export async function POST(request, { params }) {
  const { interview_id: interviewId } = await params;

  let body;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return jsonError(400, "Enter your name to join the interview.");
  }

  let decision;
  try {
    decision = await consumeRateLimit(
      rateLimitKey("interview-session", interviewId),
      SESSION_LIMIT
    );
  } catch (error) {
    if (
      error instanceof RateLimitUnavailableError ||
      error instanceof MissingConfigError
    ) {
      console.error("[session] rate limiting unavailable:", error.message);
      return jsonError(503, "This interview is temporarily unavailable.");
    }
    throw error;
  }

  const headers = rateLimitHeaders(decision, SESSION_LIMIT.limit);
  if (!decision.allowed) {
    return jsonError(
      429,
      `This interview has taken too many new joins this hour. Try again in ${decision.retryAfterSeconds} seconds.`,
      headers
    );
  }

  try {
    const interview = await findInterview(interviewId);
    if (!interview) {
      return jsonError(404, "This interview link is not valid or has been removed.", headers);
    }

    const session = await createSession({
      interviewId,
      userName: body.userName,
      userEmail: body.userEmail,
    });

    return NextResponse.json(
      {
        sessionToken: session.session_token,
        interview: {
          interview_id: interview.interview_id,
          jobPosition: interview.jobPosition,
          duration: interview.duration,
          type: interview.type,
          questionList: interview.questionList,
        },
      },
      { headers }
    );
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error("[session]", error.message);
      return jsonError(503, "This interview is temporarily unavailable.", headers);
    }
    console.error("[session] unexpected failure:", error);
    return jsonError(500, "This interview could not be started.", headers);
  }
}
