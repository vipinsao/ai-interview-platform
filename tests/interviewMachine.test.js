import test from "node:test";
import assert from "node:assert/strict";
import {
  MODE,
  STATUS,
  createInitialState,
  interviewReducer,
} from "../lib/interviewMachine.js";

const QUESTIONS = [
  { question: "What is a closure?", type: "Technical" },
  { question: "Describe a conflict you resolved.", type: "Behavioral" },
];

const start = () =>
  interviewReducer(createInitialState(QUESTIONS), { type: "start" });

test("refuses to start an interview with no questions", () => {
  const state = interviewReducer(createInitialState([]), { type: "start" });
  assert.equal(state.status, STATUS.ABORTED);
  assert.match(state.error, /no questions/);
});

test("a scored answer advances to the next question", () => {
  let state = interviewReducer(start(), { type: "question_spoken" });
  assert.equal(state.status, STATUS.LISTENING);

  state = interviewReducer(state, { type: "submit_answer" });
  state = interviewReducer(state, {
    type: "answer_scored",
    transcript: "A closure captures its scope.",
    score: { score: 8, strengths: ["clear"], gaps: [], suggestedImprovement: "Add an example." },
  });

  assert.equal(state.status, STATUS.ASKING);
  assert.equal(state.index, 1);
  assert.equal(state.answers.length, 1);
  assert.equal(state.answers[0].score, 8);
  assert.equal(state.answers[0].type, "Technical");
});

test("a scoring failure keeps the transcript and continues the interview", () => {
  let state = interviewReducer(start(), { type: "question_spoken" });
  state = interviewReducer(state, {
    type: "scoring_failed",
    transcript: "my answer",
    error: "provider timeout",
  });

  assert.equal(state.answers[0].transcript, "my answer");
  assert.equal(state.answers[0].score, null);
  assert.equal(state.status, STATUS.ASKING);
  assert.match(state.notice, /could not be scored/);
});

test("the last answer moves the session to finishing, not to a third question", () => {
  let state = start();
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    state = interviewReducer(state, { type: "question_spoken" });
    state = interviewReducer(state, {
      type: "answer_scored",
      transcript: `answer ${i}`,
      score: { score: 5, strengths: [], gaps: [], suggestedImprovement: "-" },
    });
  }
  assert.equal(state.status, STATUS.FINISHING);
  assert.equal(state.answers.length, 2);
});

test("no speech recognition drops to typed answers instead of listening", () => {
  const state = interviewReducer(start(), {
    type: "fallback_to_typing",
    reason: "Firefox has no speech recognition.",
  });
  assert.equal(state.mode, MODE.TYPED);
  assert.equal(state.status, STATUS.AWAITING);
  assert.equal(state.notice, "Firefox has no speech recognition.");
});

test("silence hands control back to the candidate rather than looping", () => {
  let state = interviewReducer(start(), { type: "question_spoken" });
  state = interviewReducer(state, { type: "silence" });
  assert.equal(state.status, STATUS.AWAITING);
  assert.match(state.notice, /did not catch/);

  state = interviewReducer(state, { type: "listen_again" });
  assert.equal(state.status, STATUS.LISTENING);
  assert.equal(state.notice, null);
});

test("a skipped question is recorded unscored and does not stall the session", () => {
  let state = interviewReducer(start(), { type: "question_spoken" });
  state = interviewReducer(state, { type: "skip_question" });
  assert.equal(state.answers[0].scoreError, "skipped by candidate");
  assert.equal(state.index, 1);
  assert.equal(state.status, STATUS.ASKING);
});

test("a failed save can be retried without losing the answers", () => {
  let state = interviewReducer(start(), { type: "question_spoken" });
  state = interviewReducer(state, {
    type: "answer_scored",
    transcript: "an answer",
    score: { score: 6, strengths: [], gaps: [], suggestedImprovement: "-" },
  });
  state = interviewReducer(state, { type: "abort", reason: "save failed" });
  assert.equal(state.status, STATUS.ABORTED);

  state = interviewReducer(state, { type: "retry_finish" });
  assert.equal(state.status, STATUS.FINISHING);
  assert.equal(state.error, null);
  assert.equal(state.answers.length, 1);
});
