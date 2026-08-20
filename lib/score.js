/**
 * Aggregating per-answer scores into the figures the recruiter sees.
 *
 * Deliberately arithmetic rather than a second model call: the same set of
 * answers must always produce the same overall rating, and a recruiter has to
 * be able to see where a number came from.
 */

export const RATING_KEYS = [
  "technicalSkills",
  "communication",
  "problemSolving",
  "experience",
];

/** Interview question types (services/Constants.jsx) mapped onto rating buckets. */
const TYPE_TO_RATING_KEY = {
  technical: "technicalSkills",
  behavioral: "communication",
  leadership: "communication",
  "problem solving": "problemSolving",
  experience: "experience",
};

export function ratingKeyForType(type) {
  if (typeof type !== "string") return null;
  return TYPE_TO_RATING_KEY[type.trim().toLowerCase()] ?? null;
}

function mean(values) {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

/**
 * @param {Array<{type?: string, score?: number|null}>} answers
 * @returns {{answered: number, overall: number|null, rating: Record<string, number|null>}}
 *
 * Answers with no score (the model failed, or the candidate skipped) are
 * excluded rather than counted as zero — a scoring outage must not look like a
 * bad candidate. A rating bucket with no questions of that type falls back to
 * the overall mean, and is null when nothing at all was scored.
 */
export function aggregateScores(answers) {
  const scored = (Array.isArray(answers) ? answers : []).filter(
    (a) => a && typeof a.score === "number" && Number.isFinite(a.score)
  );

  const overall = mean(scored.map((a) => a.score));
  const rating = {};

  for (const key of RATING_KEYS) {
    const forKey = scored
      .filter((a) => ratingKeyForType(a.type) === key)
      .map((a) => a.score);
    rating[key] = forKey.length > 0 ? mean(forKey) : overall;
  }

  return { answered: scored.length, overall, rating };
}

/** Mean of the four rating buckets, as shown on the candidate report card. */
export function averageRating(rating) {
  const values = RATING_KEYS.map((key) => rating?.[key]).filter(
    (value) => typeof value === "number" && Number.isFinite(value)
  );
  return mean(values);
}
