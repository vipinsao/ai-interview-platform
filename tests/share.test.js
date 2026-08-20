import test from "node:test";
import assert from "node:assert/strict";
import {
  isShareToken,
  mintShareToken,
  shareExpiry,
  shareLinkState,
  shareUrl,
  SHARE_LINK_TTL_MS,
} from "../lib/share.js";

const TOKEN = "66666666-6666-4666-8666-666666666666";

test("only a version 4 UUID is accepted as a token", () => {
  assert.equal(isShareToken(TOKEN), true);
  assert.equal(isShareToken(TOKEN.toUpperCase()), true);

  for (const value of [
    "",
    "1",
    "not-a-token",
    TOKEN.slice(0, -1),
    `${TOKEN} `,
    "66666666-6666-1666-8666-666666666666", // version 1
    "66666666-6666-4666-c666-666666666666", // bad variant
    "' or 1=1 --",
    null,
    undefined,
    12,
    {},
  ]) {
    assert.equal(isShareToken(value), false, `${String(value)} must not be a token`);
  }
});

test("minted tokens are version 4 UUIDs and do not repeat", () => {
  const tokens = new Set(Array.from({ length: 500 }, () => mintShareToken()));
  assert.equal(tokens.size, 500);
  for (const token of tokens) assert.equal(isShareToken(token), true);
});

test("a link is valid until its expiry and not after", () => {
  const now = Date.parse("2026-05-01T00:00:00Z");
  const expiresAt = shareExpiry(now).toISOString();

  assert.equal(shareLinkState({ token: TOKEN, expiresAt }, now), "valid");
  assert.equal(shareLinkState({ token: TOKEN, expiresAt }, now + SHARE_LINK_TTL_MS - 1), "valid");
  assert.equal(shareLinkState({ token: TOKEN, expiresAt }, now + SHARE_LINK_TTL_MS), "expired");
  assert.equal(shareLinkState({ token: TOKEN, expiresAt }, now + SHARE_LINK_TTL_MS + 1), "expired");
});

test("a report that was never shared has no link", () => {
  assert.equal(shareLinkState({ token: null, expiresAt: null }), "none");
  assert.equal(shareLinkState({}), "none");
  assert.equal(shareLinkState(), "none");
});

test("a token with no expiry is treated as expired, never as eternal", () => {
  assert.equal(shareLinkState({ token: TOKEN, expiresAt: null }), "expired");
  assert.equal(shareLinkState({ token: TOKEN, expiresAt: "not a date" }), "expired");
});

test("the link is built without a doubled slash", () => {
  assert.equal(shareUrl("https://example.com", TOKEN), `https://example.com/report/${TOKEN}`);
  assert.equal(shareUrl("https://example.com/", TOKEN), `https://example.com/report/${TOKEN}`);
});
