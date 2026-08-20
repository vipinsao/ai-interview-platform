/**
 * Reading and sharing candidate reports.
 *
 * Everything here runs with the service-role key. The recruiter side could go
 * through row level security, but the public side cannot: the viewer of a
 * shared link has no account at all, and giving the browser a key that can read
 * the feedback table would let it read every report in the project. So the
 * server holds the key and answers exactly one question — "what is the report
 * behind this token" — and ownership is re-checked here for the recruiter side.
 */
import { isShareToken, mintShareToken, shareExpiry, shareLinkState } from "../share.js";
import { serverAdminClient } from "./supabase.js";

/**
 * The feedback row, but only if the signed-in recruiter owns the interview it
 * belongs to. Returns null for "does not exist" and for "not yours" alike, so
 * the caller cannot turn this into a probe for which report ids exist.
 */
export async function findOwnedFeedback(feedbackId, userEmail) {
  const db = serverAdminClient();

  const { data: feedback, error } = await db
    .from("interview-feedback")
    .select("id, interview_id, share_token, share_expires_at")
    .eq("id", feedbackId)
    .maybeSingle();

  if (error) throw new Error(`report lookup failed: ${error.message}`);
  if (!feedback) return null;

  const { data: interview, error: interviewError } = await db
    .from("Interviews")
    .select("userEmail")
    .eq("interview_id", feedback.interview_id)
    .maybeSingle();

  if (interviewError) throw new Error(`interview lookup failed: ${interviewError.message}`);
  if (!interview || interview.userEmail !== userEmail) return null;

  return feedback;
}

/**
 * Mint a link, or hand back the one already in force.
 *
 * Reusing a valid token matters: pressing Share twice would otherwise silently
 * break the link already sent to a colleague.
 */
export async function issueShareLink(feedback, now = Date.now()) {
  const current = {
    token: feedback.share_token,
    expiresAt: feedback.share_expires_at,
  };
  if (shareLinkState(current, now) === "valid") return current;

  const token = mintShareToken();
  const expiresAt = shareExpiry(now).toISOString();

  const { error } = await serverAdminClient()
    .from("interview-feedback")
    .update({ share_token: token, share_expires_at: expiresAt })
    .eq("id", feedback.id);

  if (error) throw new Error(`could not create the share link: ${error.message}`);
  return { token, expiresAt };
}

export async function revokeShareLink(feedbackId) {
  const { error } = await serverAdminClient()
    .from("interview-feedback")
    .update({ share_token: null, share_expires_at: null })
    .eq("id", feedbackId);

  if (error) throw new Error(`could not revoke the share link: ${error.message}`);
}

/**
 * The report behind a share token.
 *
 * The token is validated as a UUID before any query runs, the lookup is an
 * equality match on a unique index, and there is no code path that returns more
 * than one row. E-mail addresses are not selected: whoever holds the link can
 * see the assessment, and does not need the candidate's contact details.
 *
 * @returns {Promise<null | {expired: true} | {report: object}>}
 */
export async function findSharedReport(token) {
  if (!isShareToken(token)) return null;

  const db = serverAdminClient();
  const { data, error } = await db
    .from("interview-feedback")
    .select("userName, created_at, feedback, share_expires_at, interview_id")
    .eq("share_token", token)
    .maybeSingle();

  if (error) throw new Error(`shared report lookup failed: ${error.message}`);
  if (!data) return null;

  if (shareLinkState({ token, expiresAt: data.share_expires_at }) !== "valid") {
    return { expired: true };
  }

  const { data: interview } = await db
    .from("Interviews")
    .select("jobPosition")
    .eq("interview_id", data.interview_id)
    .maybeSingle();

  return {
    report: {
      userName: data.userName,
      completedAt: data.created_at,
      jobPosition: interview?.jobPosition ?? null,
      feedback: data.feedback,
      expiresAt: data.share_expires_at,
    },
  };
}
