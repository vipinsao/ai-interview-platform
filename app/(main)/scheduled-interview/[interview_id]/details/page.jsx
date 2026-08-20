"use client";
import { useUser } from "@/app/provider";
import { supabase } from "@/services/supabaseClient";
import { useParams } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import InterviewDetailContainer from "./_components/InterviewDetailContainer";
import CandidateList from "./_components/CandidateList";
import { resolveOwnedInterview } from "@/lib/ownership";

function InterviewDetails() {
  const { interview_id } = useParams();
  const { user } = useUser();
  const [result, setResult] = useState({ status: "loading" });

  const getInterviewDetail = useCallback(async () => {
    // The query is scoped to the signed-in user's email, so another
    // recruiter's interview simply comes back empty. That used to render as a
    // page stuck on "Loading..."; now the denial is an explicit state.
    const { data, error } = await supabase
      .from("Interviews")
      .select(
        `userEmail,jobPosition,jobDescription,questionList,type,duration,interview_id,created_at,interview-feedback(id,userEmail,userName,feedback,created_at,share_token,share_expires_at)`
      )
      .eq("userEmail", user?.email)
      .eq("interview_id", interview_id);

    if (error) {
      setResult({ status: "error", message: error.message });
      return;
    }
    setResult(resolveOwnedInterview(data, { userEmail: user?.email }));
  }, [interview_id, user?.email]);

  useEffect(() => {
    if (user) getInterviewDetail();
  }, [user, getInterviewDetail]);

  if (result.status === "loading" || !user) {
    return <p className="mt-5 text-gray-500">Loading interview…</p>;
  }

  if (result.status === "error") {
    return (
      <p className="mt-5 text-red-700">
        Could not load this interview: {result.message}
      </p>
    );
  }

  if (result.status !== "ok") {
    return (
      <div className="mt-5">
        <h2 className="font-bold text-2xl">Interview not available</h2>
        <p className="text-gray-600 mt-2">
          This interview does not exist, or it belongs to another account.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <h2 className="font-bold text-2xl ">Interview Details</h2>
      <InterviewDetailContainer interviewDetail={result.interview} />
      <CandidateList candidate={result.interview?.["interview-feedback"]} />
    </div>
  );
}

export default InterviewDetails;
