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
  // Deliberately not guarded on `typeof owner === "string"`. It was, and that
  // made this fail open in exactly the case it exists to catch: a query that
  // forgets to select userEmail returns undefined, which is not equal to the
  // signed-in address but was being waved through as "not a string, so not a
  // mismatch". A row this helper cannot prove belongs to the caller is refused.
  if (interview?.userEmail !== userEmail) {
    return { status: "forbidden" };
  }
  return { status: "ok", interview };
}
