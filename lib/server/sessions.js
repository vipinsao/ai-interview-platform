/**
 * Candidate sessions and the scores issued during them.
 *
 * A candidate has no account, and until now had no identity either: every
 * request they made carried the interview id, which every other candidate
 * holding the same invite link also has. Two consequences, both real:
 *
 *   - Requests from different candidates were indistinguishable, so they shared
 *     one rate limit budget. Twenty requests from anybody and the next genuine
 *     candidate to finish their interview got a 429.
 *   - Nothing tied a score to the person it was issued to, so the report had to
 *     be assembled from whatever the browser sent back.
 *
 * A session token fixes both. It is minted server-side when the candidate joins,
 * it is unguessable, and it is what the scores are filed under.
 */
import { serverAdminClient } from "./supabase.js";

/** Every field of the interview the server itself needs. Never sent as-is. */
const INTERVIEW_FIELDS =
  "interview_id, jobPosition, jobDescription, duration, type, questionList";

export async function createSession({ interviewId, userName, userEmail }) {
  const { data, error } = await serverAdminClient()
    .from("interview_sessions")
    .insert([
      {
        interview_id: interviewId,
        user_name: userName,
        user_email: userEmail || null,
      },
    ])
    .select("session_token, interview_id")
    .single();

  if (error) throw new Error(`could not start the session: ${error.message}`);
  return data;
}

/**
 * The session and the interview it belongs to, in one place.
 *
 * Returns null for an unknown token. The token is the credential, so a bad one
 * is simply not a session — there is nothing else to tell the caller.
 */
export async function findSessionWithInterview(sessionToken) {
  const db = serverAdminClient();

  const { data: session, error } = await db
    .from("interview_sessions")
    .select("session_token, interview_id, user_name, user_email, submitted_at")
    .eq("session_token", sessionToken)
    .maybeSingle();

  if (error) throw new Error(`session lookup failed: ${error.message}`);
  if (!session) return null;

  const { data: interview, error: interviewError } = await db
    .from("Interviews")
    .select(INTERVIEW_FIELDS)
    .eq("interview_id", session.interview_id)
    .maybeSingle();

  if (interviewError) throw new Error(`interview lookup failed: ${interviewError.message}`);
  if (!interview) return null;

  return { session, interview };
}

/**
 * Store one issued score.
 *
 * Write-once except over a null score, which is enforced by
 * record_answer_score() in the database rather than here — a check in
 * JavaScript would be straddled by two concurrent submissions of the same
 * answer. Returns the score that is actually stored, which is not necessarily
 * the one just passed in.
 */
export async function recordAnswerScore({
  sessionToken,
  questionIndex,
  question,
  questionType,
  transcript,
  score,
  strengths,
  gaps,
  suggestedImprovement,
}) {
  const { data, error } = await serverAdminClient().rpc("record_answer_score", {
    p_session_token: sessionToken,
    p_question_index: questionIndex,
    p_question: question,
    p_question_type: questionType,
    p_transcript: transcript ?? "",
    p_score: score,
    p_strengths: strengths ?? [],
    p_gaps: gaps ?? [],
    p_suggested: suggestedImprovement ?? "",
  });

  if (error) throw new Error(`could not record the score: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    recorded: row?.recorded === true,
    finalScore: row?.final_score ?? null,
  };
}

export async function listAnswerScores(sessionToken) {
  const { data, error } = await serverAdminClient()
    .from("answer_scores")
    .select(
      "question_index, question, question_type, transcript, score, strengths, gaps, suggested_improvement"
    )
    .eq("session_token", sessionToken)
    .order("question_index", { ascending: true });

  if (error) throw new Error(`score lookup failed: ${error.message}`);
  return data ?? [];
}

export async function markSessionSubmitted(sessionToken) {
  const { error } = await serverAdminClient()
    .from("interview_sessions")
    .update({ submitted_at: new Date().toISOString() })
    .eq("session_token", sessionToken);

  if (error) throw new Error(`could not close the session: ${error.message}`);
}
