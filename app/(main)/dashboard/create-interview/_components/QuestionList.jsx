"use client";
import { Button } from "@/components/ui/button";
import { v4 as uuidv4 } from "uuid";
import { Loader, Loader2Icon } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import QuestionListContainer from "./QuestionListContainer";
import { supabase } from "@/services/supabaseClient";
import { postWithAuth } from "@/services/apiClient";
import { useUser } from "@/app/provider";

function QuestionList({ formData, onCreateLink }) {
  const { user } = useUser();
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState(null);
  const [questionList, setQuestionList] = useState([]);

  // The endpoint validates the model's reply against a schema and returns
  // { interviewQuestions }, so there is no fenced-JSON unwrapping to do here.
  const generateQuestionList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await postWithAuth("/api/ai-model", formData);
      setQuestionList(result?.interviewQuestions ?? []);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [formData]);

  useEffect(() => {
    if (formData) generateQuestionList();
  }, [formData, generateQuestionList]);

  const onFinish = async () => {
    if (questionList.length === 0) {
      toast.error("Generate questions before creating the interview link.");
      return;
    }

    setSaveLoading(true);
    const interview_id = uuidv4();

    const { error: insertError } = await supabase
      .from("Interviews")
      .insert([
        {
          ...formData,
          questionList,
          userEmail: user?.email,
          interview_id,
        },
      ])
      .select();

    // Previously the failure was ignored: the user got an interview link for a
    // row that was never written, and was charged a credit for it.
    if (insertError) {
      setSaveLoading(false);
      toast.error(`Could not save the interview: ${insertError.message}`);
      return;
    }

    const { error: creditError } = await supabase
      .from("Users")
      .update({ credits: Number(user?.credits) - 1 })
      .eq("email", user?.email)
      .select();

    if (creditError) {
      console.error("Credit update failed:", creditError.message);
    }

    setSaveLoading(false);
    onCreateLink(interview_id);
  };

  return (
    <div>
      {loading && (
        <div className="p-5 bg-blue-50 rounded-xl border border-primary flex gap-5 items-center">
          <Loader2Icon className="animate-spin" />
          <div>
            <h2 className="font-medium">Generating Interview Questions</h2>
            <p className="text-primary">
              Our AI is crafting personalized questions based on your job
              position
            </p>
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="p-5 bg-red-50 border border-red-300 rounded-xl">
          <h2 className="font-medium text-red-800">
            Could not generate questions
          </h2>
          <p className="text-sm text-red-700 mt-1">{error}</p>
          <Button
            variant="outline"
            className="mt-3 cursor-pointer"
            onClick={generateQuestionList}
          >
            Try again
          </Button>
        </div>
      )}

      {!loading && questionList.length > 0 && (
        <QuestionListContainer questionList={questionList} />
      )}

      <div className="flex justify-end mt-10">
        <Button
          onClick={onFinish}
          disabled={saveLoading || loading || questionList.length === 0}
          className="cursor-pointer"
        >
          {saveLoading && <Loader className="animate-spin" />}
          Create Interview Link &amp; Finish
        </Button>
      </div>
    </div>
  );
}

export default QuestionList;
