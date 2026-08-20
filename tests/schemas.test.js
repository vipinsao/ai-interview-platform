import test from "node:test";
import assert from "node:assert/strict";
import {
  answerScoreSchema,
  questionListSchema,
  summarySchema,
} from "../lib/schemas.js";

test("a well-formed question list is accepted", () => {
  const parsed = questionListSchema.parse({
    interviewQuestions: [{ question: "What is a closure?", type: "Technical" }],
  });
  assert.equal(parsed.interviewQuestions.length, 1);
});

test("an empty question list is rejected rather than shown as an empty interview", () => {
  assert.equal(questionListSchema.safeParse({ interviewQuestions: [] }).success, false);
});

test("a score outside 0-10 is rejected", () => {
  const result = answerScoreSchema.safeParse({
    score: 42,
    strengths: [],
    gaps: [],
    suggestedImprovement: "n/a",
  });
  assert.equal(result.success, false);
});

test("a score returned as a string is rejected, so it can never render as NaN", () => {
  const result = answerScoreSchema.safeParse({
    score: "seven",
    suggestedImprovement: "n/a",
  });
  assert.equal(result.success, false);
});

test("strengths and gaps default to empty arrays when the model omits them", () => {
  const parsed = answerScoreSchema.parse({
    score: 7,
    suggestedImprovement: "Give a concrete example.",
  });
  assert.deepEqual(parsed.strengths, []);
  assert.deepEqual(parsed.gaps, []);
});

test("a free-prose recommendation is rejected in favour of the fixed set", () => {
  assert.equal(
    summarySchema.safeParse({
      summary: "Went well.",
      recommendation: "Probably hire them I guess",
      recommendationMsg: "Strong candidate.",
    }).success,
    false
  );
  assert.equal(
    summarySchema.safeParse({
      summary: "Went well.",
      recommendation: "Yes",
      recommendationMsg: "Strong candidate.",
    }).success,
    true
  );
});
