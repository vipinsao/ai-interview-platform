import { serverAdminClient } from "./supabase.js";

/**
 * Candidate-side data access.
 *
 * A candidate has no account — the shareable link is the only credential they
 * hold — so the browser cannot be given a Supabase key that reads the
 * Interviews table. If it were, the anon key would be able to list every
 * interview in the project, job descriptions and question lists included.
 * Instead row level security denies anonymous access outright and these
 * server-side functions fetch exactly the one row the link names, returning
 * only the fields the candidate is meant to see.
 */

const CANDIDATE_FIELDS = "interview_id, jobPosition, jobDescription, duration, type, questionList";

export async function findInterview(interviewId) {
  if (typeof interviewId !== "string" || interviewId.length === 0) return null;

  const { data, error } = await serverAdminClient()
    .from("Interviews")
    .select(CANDIDATE_FIELDS)
    .eq("interview_id", interviewId)
    .maybeSingle();

  if (error) {
    console.error("[interviews] lookup failed:", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Stores a completed interview. Written here rather than from the browser so
 * that anonymous clients need no write access to the table at all, and so a
 * row can only be created for an interview that exists.
 */
export async function saveFeedback({
  interviewId,
  userName,
  userEmail,
  feedback,
}) {
  const { error } = await serverAdminClient()
    .from("interview-feedback")
    .insert([
      {
        interview_id: interviewId,
        userName,
        userEmail,
        feedback,
        recommended: false,
      },
    ]);

  if (error) throw new Error(error.message);
}
