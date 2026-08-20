"use client";
import React, { useContext } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { InterviewDataContext } from "@/context/InterviewDataContext";
import { Button } from "@/components/ui/button";
import InterviewSession from "./_components/InterviewSession";

/**
 * The candidate's name, session token and question list are held in React
 * context, set on the join page. A refresh or a direct visit loses them, which
 * used to render a page that sat on "Interview in Progress..." forever. Now it
 * says so and links back.
 *
 * Answers already given are not lost with it: each score is written server-side
 * as it is issued, so a refresh costs the rest of the interview, not the part
 * already completed.
 *
 * All session hooks live in InterviewSession so that this guard can return
 * early without changing the number of hooks React sees between renders.
 */
function StartInterviewPage() {
  const { interview_id } = useParams();
  const { interviewInfo } = useContext(InterviewDataContext);

  if (!interviewInfo?.interviewData || !interviewInfo?.sessionToken) {
    return (
      <div className="p-10 lg:px-48 xl:px-56">
        <div className="bg-white border rounded-lg p-8 flex flex-col items-start gap-3">
          <h2 className="font-bold text-xl">This session has expired</h2>
          <p className="text-gray-600">
            Interview sessions are not resumable after a page refresh. Open the
            interview link again and re-enter your details to start over.
          </p>
          <Link href={`/interview/${interview_id}`}>
            <Button className="cursor-pointer">Back to the interview link</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <InterviewSession interviewInfo={interviewInfo} interviewId={interview_id} />
  );
}

export default StartInterviewPage;
