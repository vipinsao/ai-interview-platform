/**
 * Shareable read-only report links.
 *
 * A recruiter often needs to show a candidate's report to a colleague who has
 * no account here. The link is the whole credential, so the design is narrow on
 * purpose:
 *
 *   - The token is a version 4 UUID: 122 random bits, generated server-side by
 *     the platform's CSPRNG. Guessing one is not a realistic attack.
 *   - It is looked up by equality on a unique index and never listed. There is
 *     no endpoint that returns more than one report, so a valid token reveals
 *     exactly one report and nothing about any other.
 *   - It expires. A link that leaks into an email thread stops working.
 *   - It can be revoked, which is the only remedy available before expiry.
 *
 * What a token does NOT do: authenticate anyone. Anybody holding the link sees
 * the report, which is why the public route returns the assessment and the
 * candidate's name and withholds e-mail addresses.
 */

/** Fourteen days: long enough for a hiring loop, short enough to expire. */
export const SHARE_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Checked before the database is touched, so a malformed token never becomes a
 * query at all.
 */
export function isShareToken(value) {
  return typeof value === "string" && UUID_V4.test(value);
}

export function mintShareToken() {
  return globalThis.crypto.randomUUID();
}

export function shareExpiry(now = Date.now()) {
  return new Date(now + SHARE_LINK_TTL_MS);
}

/**
 * @returns {"none"|"expired"|"valid"}
 */
export function shareLinkState({ token, expiresAt } = {}, now = Date.now()) {
  if (!isShareToken(token)) return "none";
  // A token with no expiry is treated as expired rather than as eternal: an
  // unbounded link is the thing this feature is meant not to create.
  if (!expiresAt) return "expired";
  const expires = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= now) return "expired";
  return "valid";
}

export function shareUrl(origin, token) {
  return `${String(origin).replace(/\/+$/, "")}/report/${token}`;
}
