/**
 * Unguessable identifiers handed to people with no account.
 *
 * Both the candidate's session token and a shared report link are version 4
 * UUIDs — 122 random bits from the platform CSPRNG. Validating the shape before
 * a query runs means a malformed or hostile token never becomes a database
 * round trip, and never reaches a WHERE clause at all.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value) {
  return typeof value === "string" && UUID_V4.test(value);
}
