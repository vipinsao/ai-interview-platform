/**
 * The interview session as a pure state machine.
 *
 * Everything that can go wrong during a live session — the browser has no
 * speech recognition, the microphone is blocked, recognition errors mid
 * question, the candidate says nothing, scoring fails — is a transition here
 * rather than an ad-hoc branch inside a component. Every one of those paths
 * lands in a state the UI renders explicitly, which is what stops a session
 * hanging on a spinner with no way forward.
 */

export const STATUS = {
  IDLE: "idle",
  ASKING: "asking", // the question is being read out
  LISTENING: "listening", // microphone open
  AWAITING: "awaiting", // waiting on the candidate to act (type, retry, skip)
  SCORING: "scoring", // answer submitted, waiting on the scoring endpoint
  FINISHING: "finishing", // last answer in, building the report
  FINISHED: "finished",
  ABORTED: "aborted",
};

export const MODE = {
  VOICE: "voice",
  TYPED: "typed",
};

export function createInitialState(questions = [], mode = MODE.VOICE) {
  return {
    status: STATUS.IDLE,
    mode,
    index: 0,
    questions,
    answers: [],
    notice: null,
    error: null,
  };
}

export function currentQuestion(state) {
  return state.questions[state.index] ?? null;
}

function advance(state, answer) {
  const answers = [...state.answers, answer];
  const isLast = state.index + 1 >= state.questions.length;
  return {
    ...state,
    answers,
    notice: null,
    index: isLast ? state.index : state.index + 1,
    status: isLast ? STATUS.FINISHING : STATUS.ASKING,
  };
}

function answerFrom(state, extra) {
  const question = currentQuestion(state);
  return {
    question: question?.question ?? "",
    type: question?.type ?? "",
    ...extra,
  };
}

export function interviewReducer(state, action) {
  switch (action.type) {
    case "start":
      if (state.questions.length === 0) {
        return {
          ...state,
          status: STATUS.ABORTED,
          error: "This interview has no questions.",
        };
      }
      return { ...state, status: STATUS.ASKING, notice: null, error: null };

    case "question_spoken":
      return {
        ...state,
        status: state.mode === MODE.VOICE ? STATUS.LISTENING : STATUS.AWAITING,
      };

    // The browser cannot listen: no recognition support, microphone denied, or
    // recognition errored. Drop to typed answers rather than stranding the
    // candidate with a dead microphone.
    case "fallback_to_typing":
      return {
        ...state,
        mode: MODE.TYPED,
        status: STATUS.AWAITING,
        notice:
          action.reason ??
          "Voice input is unavailable in this browser. Please type your answer.",
      };

    // Recognition ran but heard nothing. Hand control back rather than
    // silently reopening the microphone forever.
    case "silence":
      return {
        ...state,
        status: STATUS.AWAITING,
        notice:
          "We did not catch an answer. Try speaking again, type it instead, or skip the question.",
      };

    case "listen_again":
      return { ...state, mode: MODE.VOICE, status: STATUS.LISTENING, notice: null };

    case "submit_answer":
      return { ...state, status: STATUS.SCORING, notice: null };

    case "answer_scored":
      return advance(
        state,
        answerFrom(state, {
          transcript: action.transcript,
          score: action.score.score,
          strengths: action.score.strengths,
          gaps: action.score.gaps,
          suggestedImprovement: action.score.suggestedImprovement,
        })
      );

    // Scoring failed. The answer is kept unscored so the transcript is not
    // lost, and the interview continues — an outage must not end the session.
    case "scoring_failed":
      return {
        ...advance(
          state,
          answerFrom(state, {
            transcript: action.transcript,
            score: null,
            scoreError: action.error ?? "scoring unavailable",
          })
        ),
        notice: "That answer could not be scored, but it was recorded.",
      };

    case "skip_question":
      return advance(
        state,
        answerFrom(state, {
          transcript: "",
          score: null,
          scoreError: "skipped by candidate",
        })
      );

    // The report is built and stored by the server; if that call fails the
    // session aborts with the reason, and this puts it back so the candidate
    // can retry without re-answering anything.
    case "retry_finish":
      return { ...state, status: STATUS.FINISHING, error: null, notice: null };

    case "finished":
      return { ...state, status: STATUS.FINISHED, notice: null };

    case "abort":
      return {
        ...state,
        status: STATUS.ABORTED,
        error: action.reason ?? "The interview was ended.",
      };

    default:
      return state;
  }
}
