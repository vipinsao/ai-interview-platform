/**
 * What the join screen shows a candidate who is not signed in.
 *
 * Exists so the browser never needs read access to the Interviews table: row
 * level security denies anonymous selects, and this route returns exactly the
 * row the link names.
 *
 * It returns the role and the duration, and deliberately NOT the question list
 * or the job description. Those used to be here, so anybody with a link could
 * curl the questions and prepare against them — invisible in the UI, which only
 * ever displayed the job title. They are now released by the session route,
 * when a candidate actually starts.
 */
import { NextResponse } from "next/server";

import { findInterview } from "@/lib/server/interviews";
import { MissingConfigError } from "@/lib/server/env";
import { jsonError } from "@/lib/server/http";

export async function GET(_request, { params }) {
  const { interview_id: interviewId } = await params;

  try {
    const interview = await findInterview(interviewId);
    if (!interview) {
      return jsonError(404, "This interview link is not valid or has been removed.");
    }
    return NextResponse.json({
      interview_id: interview.interview_id,
      jobPosition: interview.jobPosition,
      duration: interview.duration,
      type: interview.type,
    });
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error("[interview]", error.message);
      return jsonError(503, "This interview is temporarily unavailable.");
    }
    console.error("[interview] unexpected failure:", error);
    return jsonError(500, "This interview is temporarily unavailable.");
  }
}
