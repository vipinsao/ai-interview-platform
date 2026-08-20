/**
 * Ownership checks for recruiter-facing reads.
 *
 * Supabase queries in this app already filter by the signed-in user's email,
 * so a request for someone else's interview comes back as an empty array. That
 * is a denial, but on its own it renders as a page that never finishes
 * loading. This turns the empty result into an explicit outcome the UI can
 * show, and re-checks the owner on the returned row so a future query that
 * forgets the filter fails loudly instead of silently leaking.
 *
 * Note: this is defence in depth on the client. The authoritative check is the
 * row level security policy in supabase/schema.sql, which runs in Postgres.
 */
export function resolveOwnedInterview(rows, { userEmail }) {
  if (!userEmail) return { status: "unauthenticated" };
  if (!Array.isArray(rows) || rows.length === 0) return { status: "not-found" };

  const interview = rows[0];
  const owner = interview?.userEmail;
  if (typeof owner === "string" && owner !== userEmail) {
    return { status: "forbidden" };
  }
  return { status: "ok", interview };
}
