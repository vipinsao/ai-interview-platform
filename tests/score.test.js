import test from "node:test";
import assert from "node:assert/strict";
import { aggregateScores, averageRating, ratingKeyForType } from "../lib/score.js";

test("maps question types onto rating buckets, case insensitively", () => {
  assert.equal(ratingKeyForType("Technical"), "technicalSkills");
  assert.equal(ratingKeyForType("problem solving"), "problemSolving");
  assert.equal(ratingKeyForType("Leadership"), "communication");
  assert.equal(ratingKeyForType("Astrology"), null);
});

test("averages per-type scores and falls back to the overall mean", () => {
  const result = aggregateScores([
    { type: "Technical", score: 8 },
    { type: "Technical", score: 6 },
    { type: "Behavioral", score: 4 },
  ]);
  assert.equal(result.answered, 3);
  assert.equal(result.overall, 6);
  assert.equal(result.rating.technicalSkills, 7);
  assert.equal(result.rating.communication, 4);
  // No experience question was asked, so the bucket reports the overall mean
  // rather than an invented zero.
  assert.equal(result.rating.experience, 6);
});

test("unscored answers are excluded, not counted as zero", () => {
  const result = aggregateScores([
    { type: "Technical", score: 9 },
    { type: "Technical", score: null, scoreError: "scoring unavailable" },
  ]);
  assert.equal(result.answered, 1);
  assert.equal(result.overall, 9);
});

test("an interview with nothing scored reports null rather than NaN", () => {
  const result = aggregateScores([{ type: "Technical", score: null }]);
  assert.equal(result.overall, null);
  assert.equal(result.rating.technicalSkills, null);
  assert.equal(averageRating(result.rating), null);
});

test("averageRating ignores missing buckets", () => {
  assert.equal(
    averageRating({ technicalSkills: 8, communication: 6, problemSolving: undefined }),
    7
  );
});
