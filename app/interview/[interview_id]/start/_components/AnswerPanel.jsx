"use client";
import React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2Icon, Mic, Keyboard, SkipForward } from "lucide-react";
import { MODE, STATUS } from "@/lib/interviewMachine";

/**
 * Everything the candidate can do at this moment, rendered from the session
 * status. There is no state in which the panel shows nothing, which is what
 * guarantees a stalled interview always offers a way forward.
 */
function AnswerPanel({
  status,
  mode,
  notice,
  typedAnswer,
  onTypedAnswerChange,
  onSubmitTyped,
  onListenAgain,
  onSwitchToTyping,
  onSkip,
}) {
  const busy = status === STATUS.SCORING || status === STATUS.FINISHING;

  return (
    <div className="mt-6 bg-white rounded-lg border p-5">
      {notice && (
        <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
          {notice}
        </p>
      )}

      {status === STATUS.ASKING && (
        <p className="text-gray-600 flex items-center gap-2">
          <Loader2Icon className="animate-spin h-4 w-4" />
          Reading the question out loud…
        </p>
      )}

      {status === STATUS.LISTENING && (
        <div className="flex flex-col gap-3">
          <p className="text-primary font-medium flex items-center gap-2">
            <Mic className="h-4 w-4" /> Listening — answer out loud, then pause.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" className="cursor-pointer" onClick={onSwitchToTyping}>
              <Keyboard /> Type instead
            </Button>
            <Button variant="outline" className="cursor-pointer" onClick={onSkip}>
              <SkipForward /> Skip question
            </Button>
          </div>
        </div>
      )}

      {status === STATUS.AWAITING && (
        <div className="flex flex-col gap-3">
          <Textarea
            value={typedAnswer}
            onChange={(event) => onTypedAnswerChange(event.target.value)}
            placeholder="Type your answer here"
            className="h-[140px]"
          />
          <div className="flex flex-wrap gap-3">
            <Button
              className="cursor-pointer"
              onClick={onSubmitTyped}
              disabled={typedAnswer.trim().length === 0}
            >
              Submit answer
            </Button>
            {mode === MODE.TYPED ? null : (
              <Button variant="outline" className="cursor-pointer" onClick={onListenAgain}>
                <Mic /> Answer by voice
              </Button>
            )}
            <Button variant="outline" className="cursor-pointer" onClick={onSkip}>
              <SkipForward /> Skip question
            </Button>
          </div>
        </div>
      )}

      {busy && (
        <p className="text-gray-600 flex items-center gap-2">
          <Loader2Icon className="animate-spin h-4 w-4" />
          {status === STATUS.SCORING
            ? "Scoring your answer…"
            : "Building your feedback report…"}
        </p>
      )}
    </div>
  );
}

export default AnswerPanel;
