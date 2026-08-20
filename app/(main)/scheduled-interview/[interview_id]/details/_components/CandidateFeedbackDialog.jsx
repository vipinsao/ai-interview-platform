import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RATING_KEYS, averageRating } from "@/lib/score";

const RATING_LABELS = {
  technicalSkills: "Technical Skills",
  communication: "Communication",
  problemSolving: "Problem Solving",
  experience: "Experience",
};

function initial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

function CandidateFeedbackDialog({ candidate }) {
  const report = candidate?.feedback;
  const feedback = report?.feedback;
  const rating = feedback?.rating ?? {};
  // Previously this summed four ratings without checking they existed, so a
  // partial report rendered as "NaN/10".
  const overall = averageRating(rating);
  const perQuestion = Array.isArray(report?.perQuestion) ? report.perQuestion : [];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={"outline"} className={"text-primary cursor-pointer"}>
          View Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Candidate report</DialogTitle>
          <DialogDescription asChild>
            <div className="mt-5">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-5">
                  <h2 className="bg-primary p-2 px-4.5 font-bold text-white text-sm rounded-full">
                    {initial(candidate?.userName)}
                  </h2>
                  <div>
                    <h2>{(candidate?.userName ?? "Unknown").toUpperCase()}</h2>
                    <h2 className="text-sm text-gray-500">
                      {candidate?.userEmail ?? "no email provided"}
                    </h2>
                  </div>
                </div>
                <h2 className="text-primary text-2xl font-bold">
                  {overall === null ? "—" : `${overall}/10`}
                </h2>
              </div>

              <div className="mt-5">
                <h2 className="font-bold">Skills assessment</h2>
                <div className="mt-3 grid grid-cols-2 gap-6">
                  {RATING_KEYS.map((key) => (
                    <div key={key}>
                      <h2 className="flex justify-between text-sm">
                        {RATING_LABELS[key]}
                        <span>
                          {typeof rating[key] === "number"
                            ? `${rating[key]}/10`
                            : "—"}
                        </span>
                      </h2>
                      <Progress
                        value={
                          typeof rating[key] === "number" ? rating[key] * 10 : 0
                        }
                        className={"mt-1"}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Ratings are the mean of the per-answer scores below, grouped by
                  question type.
                </p>
              </div>

              <div className="mt-5">
                <h2 className="font-bold">Performance summary</h2>
                <div className="p-5 bg-secondary my-3 rounded-md">
                  <p>{feedback?.summary ?? "No summary was recorded."}</p>
                  {report?.summaryGenerated === false && (
                    <p className="text-xs text-amber-700 mt-2">
                      The written summary could not be generated for this
                      session; the scores above are unaffected.
                    </p>
                  )}
                </div>
              </div>

              {perQuestion.length > 0 && (
                <div className="mt-5">
                  <h2 className="font-bold">Answer by answer</h2>
                  <div className="mt-3 flex flex-col gap-3">
                    {perQuestion.map((answer, index) => (
                      <div key={index} className="border rounded-md p-3">
                        <div className="flex justify-between gap-3">
                          <p className="font-medium text-sm">
                            {index + 1}. {answer.question}
                          </p>
                          <span className="text-sm whitespace-nowrap">
                            {typeof answer.score === "number"
                              ? `${answer.score}/10`
                              : "not scored"}
                          </span>
                        </div>
                        {answer.transcript ? (
                          <p className="text-xs text-gray-600 mt-2">
                            “{answer.transcript}”
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500 mt-2">
                            No answer recorded.
                          </p>
                        )}
                        {answer.suggestedImprovement && (
                          <p className="text-xs text-primary mt-2">
                            Suggested improvement: {answer.suggestedImprovement}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div
                className={`p-5 mt-8 rounded-md flex justify-between items-center gap-4 ${
                  feedback?.recommendation === "No" ? "bg-red-100" : "bg-green-100"
                }`}
              >
                <div>
                  <h2
                    className={`font-bold ${
                      feedback?.recommendation === "No"
                        ? "text-red-700"
                        : "text-green-700"
                    }`}
                  >
                    Recommendation: {feedback?.recommendation ?? "—"}
                  </h2>
                  <p className="text-sm">{feedback?.recommendationMsg}</p>
                </div>
                {candidate?.userEmail && (
                  <a href={`mailto:${candidate.userEmail}`}>
                    <Button className="cursor-pointer">Email candidate</Button>
                  </a>
                )}
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export default CandidateFeedbackDialog;
