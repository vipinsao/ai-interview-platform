"use client";
import { useUser } from "@/app/provider";
import { Button } from "@/components/ui/button";
import { supabase } from "@/services/supabaseClient";
import { Loader2, Video } from "lucide-react";
import React, { useEffect, useState } from "react";
import InterviewCard from "./interviewCard";
import Link from "next/link";

function LatestInterviewsList() {
  // null means "the query has not answered yet". Starting at [] made the page
  // claim the recruiter had no interviews on every single load, and the error
  // was discarded so a failed query left `data` null and crashed on .length.
  const [interviewList, setInterviewList] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const { user } = useUser();
  useEffect(() => {
    user && GetInterviewList();
  }, [user]);
  const GetInterviewList = async () => {
    setLoadFailed(false);
    const { data: Interviews, error } = await supabase
      .from("Interviews")
      .select("*")
      .eq("userEmail", user?.email)
      .order("id", { ascending: false })
      .limit(6);
    if (error) {
      console.error("Failed to load interviews:", error.message);
      setLoadFailed(true);
      return;
    }
    setInterviewList(Interviews ?? []);
  };

  return (
    <div className="my-5">
      <h2 className="font-bold text-2xl">Previously Created Interviews</h2>
      {loadFailed ? (
        <div className="p-5 flex flex-col gap-3 items-center mt-5">
          <h2 className="text-gray-600">We could not load your interviews.</h2>
          <Button
            variant={"outline"}
            onClick={GetInterviewList}
            className={"cursor-pointer"}
          >
            Retry
          </Button>
        </div>
      ) : interviewList === null ? (
        <div className="p-5 flex flex-col gap-3 items-center mt-5">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <h2 className="text-gray-500">Loading your interviews…</h2>
        </div>
      ) : interviewList.length === 0 ? (
        <div className="p-5 flex flex-col gap-3 items-center  mt-5">
          <Video className="h-10 w-10 text-primary" />
          <h2>You dont have any interview created!</h2>
          <Link href={"/dashboard/create-interview"}>
            <Button className={"cursor-pointer"}>+ Create New Interview</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {interviewList.map((interview, index) => (
            <InterviewCard interview={interview} key={index} />
          ))}
        </div>
      )}
    </div>
  );
}

export default LatestInterviewsList;
