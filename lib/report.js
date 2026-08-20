/**
 * Assembling a candidate report out of what the server recorded.
 *
 * The report used to be built from the request that ended the interview: the
 * browser sent the questions, the transcripts and the scores, and the server
 * did arithmetic over them. `lib/score.js` describes that arithmetic as
 * deterministic, which it is — and which was never the point. Determinism is
 * not provenance. Arithmetic over numbers the candidate chose produces a
 * reliably wrong answer.
 *
 * So the two inputs here are the interview's own stored `questionList` and the
 * rows `/api/score-answer` wrote as it issued each score. Neither can be
 * influenced by whoever posts the final request.
 */

/**
 * Postgres `numeric` does not arrive as a JavaScript number by the same route
 * every time: PostgREST serialises it as a JSON number, node-postgres hands
 * back a string to avoid losing precision. Both reach this function, so both
 * are normalised here rather than at each call site.
 */
function toScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  return [];
}

/**
 * One entry per question in the interview, in the interview's order.
 *
 * A question with no recorded score is reported as unanswered rather than
 * omitted — a recruiter needs to see that a candidate skipped question four,
 * and a report that silently drops it reads as a shorter interview.
 *
 * @param {Array<{question?: string, type?: string}>} questionList  from the Interviews row
 * @param {Array<object>} scoreRows                                 from answer_scores
 */
export function buildPerQuestion(questionList, scoreRows) {
  const byIndex = new Map();
  for (const row of Array.isArray(scoreRows) ? scoreRows : []) {
    const index = Number(row?.question_index);
    if (Number.isInteger(index) && index >= 0 && !byIndex.has(index)) {
      byIndex.set(index, row);
    }
  }

  return (Array.isArray(questionList) ? questionList : []).map((entry, index) => {
    const row = byIndex.get(index);
    return {
      // From the interview, never from a request: this is what stops a
      // recruiter's report card displaying text the candidate authored.
      question: typeof entry?.question === "string" ? entry.question : "",
      type: typeof entry?.type === "string" ? entry.type : "",
      transcript: typeof row?.transcript === "string" ? row.transcript : "",
      score: toScore(row?.score),
      strengths: asArray(row?.strengths),
      gaps: asArray(row?.gaps),
      suggestedImprovement:
        typeof row?.suggested_improvement === "string" ? row.suggested_improvement : "",
      answered: row !== undefined,
    };
  });
}

/** The prompt fragment the summary is written from. Scores only, no free text. */
export function describeScores(perQuestion) {
  return perQuestion
    .map(
      (answer, index) =>
        `${index + 1}. [${answer.type || "General"}] ${answer.question}\n   score: ${
          answer.score === null ? "not scored" : `${answer.score}/10`
        }`
    )
    .join("\n");
}
