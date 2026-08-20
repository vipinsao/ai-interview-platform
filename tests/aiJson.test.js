import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonBlock, parseModelJson } from "../lib/aiJson.js";

test("unwraps a fenced json block", () => {
  const reply = 'Sure!\n```json\n{"interviewQuestions":[]}\n```\nHope that helps.';
  assert.equal(extractJsonBlock(reply), '{"interviewQuestions":[]}');
});

test("finds bare json surrounded by prose", () => {
  const parsed = parseModelJson('Here you go: {"score": 7} — let me know.');
  assert.deepEqual(parsed, { ok: true, value: { score: 7 } });
});

test("reports failure instead of throwing on a prose-only reply", () => {
  const parsed = parseModelJson("I am unable to help with that request.");
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /no JSON found/);
});

test("reports failure instead of throwing on malformed json", () => {
  const parsed = parseModelJson('```json\n{"score": 7,,}\n```');
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /not valid JSON/);
});

test("handles a non-string reply", () => {
  assert.equal(extractJsonBlock(undefined), null);
  assert.equal(parseModelJson(null).ok, false);
});
