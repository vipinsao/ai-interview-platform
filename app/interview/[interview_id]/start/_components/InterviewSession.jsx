"use client";
import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Phone, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";

import { postJson } from "@/services/apiClient";
import {
  MODE,
  STATUS,
  createInitialState,
  currentQuestion,
  interviewReducer,
} from "@/lib/interviewMachine";
import { useSpeech } from "@/hooks/useSpeech";
import AlertConfirmation from "./AlertConfirmation";
import TimerComponent from "./TimerComponent";
import AnswerPanel from "./AnswerPanel";

const SILENCE_MS = 10000;

function InterviewSession({ interviewInfo, interviewId }) {
  const router = useRouter();
  const questions = interviewInfo.interviewData?.questionList ?? [];

  const [state, dispatch] = useReducer(
    interviewReducer,
    createInitialState(questions, MODE.VOICE)
  );
  const [typedAnswer, setTypedAnswer] = useState("");

  const { support, speak, listen, cancel } = useSpeech();

  const askedRef = useRef(-1);
  const startedRef = useRef(false);
  const finishingRef = useRef(false);

  const candidateName = interviewInfo.userName || "Candidate";
  const question = currentQuestion(state);

  // Start once speech support is known, so the first question is delivered in
  // the right mode instead of opening a microphone that does not exist.
  useEffect(() => {
    if (!support.ready || startedRef.current) return;
    startedRef.current = true;
    if (!support.recognition) {
      dispatch({
        type: "fallback_to_typing",
        reason:
          "This browser does not support speech recognition (Firefox does not implement it). You can type your answers instead.",
      });
    }
    dispatch({ type: "start" });
  }, [support.ready, support.recognition]);

  const submitAnswer = useCallback(
    async (transcript, questionAsked) => {
      dispatch({ type: "submit_answer" });
      try {
        const score = await postJson("/api/score-answer", {
          interview_id: interviewId,
          question: questionAsked?.question ?? "",
          questionType: questionAsked?.type ?? "Technical",
          answer: transcript,
        });
        dispatch({ type: "answer_scored", transcript, score });
      } catch (error) {
        dispatch({ type: "scoring_failed", transcript, error: error.message });
      }
      setTypedAnswer("");
    },
    [interviewId]
  );

  // Read the question out. Speech synthesis failing is not fatal — the
  // question is on screen either way.
  useEffect(() => {
    if (state.status !== STATUS.ASKING) return;
    if (askedRef.current === state.index) return;
    askedRef.current = state.index;

    let cancelled = false;
    (async () => {
      if (support.synthesis) await speak(question?.question ?? "");
      if (!cancelled) dispatch({ type: "question_spoken" });
    })();
    return () => {
      cancelled = true;
    };
  }, [state.status, state.index, support.synthesis, speak, question]);

  // Listen for the answer.
  useEffect(() => {
    if (state.status !== STATUS.LISTENING) return;

    let cancelled = false;
    const asked = question;
    (async () => {
      const result = await listen({ silenceMs: SILENCE_MS });
      if (cancelled) return;

      if (!result.ok) {
        const reason =
          result.reason === "not-allowed" || result.reason === "service-not-allowed"
            ? "Microphone access was blocked, so please type your answer."
            : `Voice input stopped (${result.reason}). Please type your answer.`;
        dispatch({ type: "fallback_to_typing", reason });
        return;
      }
      if (!result.transcript) {
        dispatch({ type: "silence" });
        return;
      }
      submitAnswer(result.transcript, asked);
    })();

    return () => {
      cancelled = true;
    };
  }, [state.status, state.index, listen, submitAnswer, question]);

  // Last answer is in. The endpoint scores, aggregates and stores the report;
  // the browser has no write access to the feedback table by design.
  useEffect(() => {
    if (state.status !== STATUS.FINISHING || finishingRef.current) return;
    finishingRef.current = true;
    cancel();

    (async () => {
      try {
        await postJson("/api/ai-feedback", {
          interview_id: interviewId,
          userName: interviewInfo.userName,
          userEmail: interviewInfo.userEmail ?? "",
          answers: state.answers,
        });
      } catch (error) {
        finishingRef.current = false;
        dispatch({
          type: "abort",
          reason: `Your answers could not be submitted: ${error.message}`,
        });
        return;
      }

      dispatch({ type: "finished" });
      router.replace(`/interview/${interviewId}/completed`);
    })();
  }, [state.status, state.answers, interviewId, interviewInfo, cancel, router]);

  const endInterview = () => {
    cancel();
    dispatch({ type: "abort", reason: "You ended the interview." });
  };

  if (state.status === STATUS.ABORTED) {
    return (
      <div className="p-10 lg:px-48 xl:px-56">
        <div className="bg-white border rounded-lg p-8 flex flex-col items-start gap-3">
          <h2 className="font-bold text-xl">Interview ended</h2>
          <p className="text-gray-600">{state.error}</p>
          {state.answers.length > 0 && (
            <Button
              className="cursor-pointer"
              onClick={() => dispatch({ type: "retry_finish" })}
            >
              Try submitting again
            </Button>
          )}
        </div>
      </div>
    );
  }

  const answeredCount = state.answers.length;
  const running = state.status !== STATUS.IDLE && state.status !== STATUS.FINISHED;

  return (
    <div className="p-10 lg:px-48 xl:px-56">
      <h2 className="font-bold text-xl flex justify-between items-center">
        AI Interview Session
        <span className="flex gap-2 items-center">
          <Timer />
          <TimerComponent startTimer={running} resetTimer={false} />
        </span>
      </h2>

      <p className="text-sm text-gray-500 mt-1">
        Question {Math.min(state.index + 1, questions.length)} of {questions.length}
        {answeredCount > 0 ? ` · ${answeredCount} answered` : ""}
        {state.mode === MODE.TYPED ? " · typed answers" : " · voice answers"}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
        <div className="bg-white h-[220px] rounded-lg border flex flex-col gap-3 items-center justify-center mt-4 shadow-lg relative">
          {state.status === STATUS.ASKING && (
            <span className="absolute inset-20 rounded-full bg-blue-100 opacity-80 animate-pulse" />
          )}
          <Image
            src="/ai-model.jpg"
            alt="AI interviewer"
            width={80}
            height={80}
            className="w-[80px] h-[80px] object-cover rounded-full z-10"
          />
          <h2 className="font-semibold z-10">AI Recruiter</h2>
        </div>
        <div className="bg-white h-[220px] rounded-lg border flex flex-col gap-3 items-center justify-center mt-4 shadow-lg">
          <div className="relative">
            {state.status === STATUS.LISTENING && (
              <span className="absolute inset-0 rounded-full bg-blue-500 opacity-75 animate-pulse" />
            )}
            <h2 className="text-2xl bg-primary text-white p-3 rounded-full px-5 relative">
              {candidateName.charAt(0).toUpperCase()}
            </h2>
          </div>
          <h2>{candidateName}</h2>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg border p-5">
        <h3 className="text-xs uppercase tracking-wide text-gray-500">
          Current question
        </h3>
        <p className="font-medium mt-1">
          {question?.question ?? "Preparing your interview…"}
        </p>
      </div>

      <AnswerPanel
        status={state.status}
        mode={state.mode}
        notice={state.notice}
        typedAnswer={typedAnswer}
        onTypedAnswerChange={setTypedAnswer}
        onSubmitTyped={() => submitAnswer(typedAnswer.trim(), question)}
        onListenAgain={() => dispatch({ type: "listen_again" })}
        onSwitchToTyping={() => {
          cancel();
          dispatch({
            type: "fallback_to_typing",
            reason: "Type your answer below.",
          });
        }}
        onSkip={() => {
          cancel();
          setTypedAnswer("");
          dispatch({ type: "skip_question" });
        }}
      />

      <div className="flex items-center gap-5 justify-center mt-6">
        <AlertConfirmation stopInterview={endInterview}>
          <Phone className="h-12 w-12 p-3 bg-red-500 rounded-full text-white cursor-pointer hover:bg-red-900 transition-all shadow-lg" />
        </AlertConfirmation>
      </div>
    </div>
  );
}

export default InterviewSession;
