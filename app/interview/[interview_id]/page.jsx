"use client";
import React, { useCallback, useContext, useEffect, useState } from "react";
import Image from "next/image";
import { Clock, Info, Loader2Icon, Video } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { InterviewDataContext } from "@/context/InterviewDataContext";

function Interview() {
  const { interview_id } = useParams();
  const [interviewData, setInterviewData] = useState(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [linkError, setLinkError] = useState(null);

  const { setInterviewInfo } = useContext(InterviewDataContext);
  const router = useRouter();

  // Read through the API rather than straight from Supabase: the candidate is
  // not signed in, and row level security denies anonymous reads of the
  // Interviews table so the anon key cannot be used to list other people's
  // interviews. The route returns exactly the row this link names.
  //
  // Every exit path here has to clear `loading`. It previously returned early
  // on an unknown link and on a query error, leaving the page spinning with
  // the Join button disabled forever.
  const getInterviewDetail = useCallback(async () => {
    setLoading(true);
    setLinkError(null);
    try {
      const response = await fetch(`/api/interview/${interview_id}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setLinkError(payload?.error ?? "We could not load this interview.");
      } else {
        setInterviewData(payload);
      }
    } catch {
      setLinkError("We could not load this interview. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [interview_id]);

  useEffect(() => {
    if (interview_id) getInterviewDetail();
  }, [interview_id, getInterviewDetail]);

  const onJoinInterview = () => {
    if (!interviewData) {
      toast.error("This interview link is no longer valid.");
      return;
    }
    setJoining(true);
    setInterviewInfo({
      userName: userName.trim(),
      userEmail: userEmail.trim(),
      interviewData,
    });
    router.push("/interview/" + interview_id + "/start");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 mt-4 w-full">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-lg flex flex-col items-center">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-4">
          <Image src="/logo.png" alt="Logo" width={40} height={40} />
          <h1 className="text-2xl font-bold text-gray-700">AI-Recruiter</h1>
        </div>

        {/* Subtitle */}
        <h2 className="text-gray-500 mb-4 text-center">
          AI-Powered Interview Platform
        </h2>

        {/* Illustration Image */}
        <Image
          src="/interview.jpg"
          alt="Interview Illustration"
          width={200}
          height={100}
          className="mb-4"
        />

        {/* Title */}
        <h2 className="text-xl font-semibold text-gray-800 text-center">
          {interviewData?.jobPosition}
        </h2>

        {/* Timer */}
        <div className="flex items-center gap-2 text-gray-500 text-sm mt-2 mb-6">
          <Clock className="h-4 w-4" />
          <span>{interviewData?.duration}</span>
        </div>

        {/* Input Section */}
        <div className="w-full">
          <label
            className="block font-semibold text-gray-600 text-sm mb-1"
            htmlFor="name"
          >
            Enter Your Full Name
          </label>
          <Input
            id="name"
            placeholder="e.g. John Smith"
            className="w-full"
            onChange={(e) => setUserName(e.target.value)}
          />
        </div>
        <div className="w-full">
          <label
            className="block mt-2 font-semibold text-gray-600 text-sm mb-1"
            htmlFor="name"
          >
            Enter Your Email
          </label>
          <Input
            id="name"
            placeholder="e.g. Alex@gmail.com"
            className="w-full"
            onChange={(e) => setUserEmail(e.target.value)}
          />
        </div>
        <div className="p-3 bg-blue-100 flex gap-4 rounded-lg mt-2 flex-col">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 mt-1 text-primary" />
            <h2 className="font-bold">Before you begin</h2>
          </div>
          <ul>
            <li className="text-sm text-primary">
              - Test your camera and microphone
            </li>
            <li className="text-sm text-primary">
              - Ensure you have a stable internet connection
            </li>
            <li className="text-sm text-primary">
              - Find a Quiet place for interview
            </li>
          </ul>
        </div>
        {linkError && (
          <p className="mt-4 w-full text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
            {linkError}
          </p>
        )}
        <Button
          className={"mt-5 w-full font-bold flex items-center"}
          disabled={loading || joining || Boolean(linkError) || !userName.trim()}
          onClick={() => onJoinInterview()}
        >
          {joining ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <Video />
          )}{" "}
          {loading ? "Loading interview…" : "Join Interview"}
        </Button>
      </div>
    </div>
  );
}

export default Interview;
