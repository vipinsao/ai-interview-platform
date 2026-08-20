import test from "node:test";
import assert from "node:assert/strict";
import { resolveOwnedInterview } from "../lib/ownership.js";

const ROW = { interview_id: "abc", userEmail: "owner@example.com" };

test("the owner gets the interview", () => {
  const result = resolveOwnedInterview([ROW], { userEmail: "owner@example.com" });
  assert.equal(result.status, "ok");
  assert.equal(result.interview, ROW);
});

test("another user's request resolves to not-found, never to the row", () => {
  // The Supabase query filters on the signed-in email, so a cross-user request
  // comes back empty. This must surface as a denial, not as a page that never
  // stops loading.
  const result = resolveOwnedInterview([], { userEmail: "someone@example.com" });
  assert.equal(result.status, "not-found");
  assert.equal(result.interview, undefined);
});

test("a row that slipped through with the wrong owner is refused", () => {
  const result = resolveOwnedInterview([ROW], { userEmail: "someone@example.com" });
  assert.equal(result.status, "forbidden");
  assert.equal(result.interview, undefined);
});

test("an anonymous caller is never handed an interview", () => {
  assert.equal(
    resolveOwnedInterview([ROW], { userEmail: undefined }).status,
    "unauthenticated"
  );
});
