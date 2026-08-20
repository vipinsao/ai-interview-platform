import React from "react";
import { Progress } from "@/components/ui/progress";
import { RATING_KEYS, averageRating, ratingProvenance } from "@/lib/score";

/**
 * One candidate report, rendered the same way for the recruiter who owns it and
 * for whoever opens a shared link. Extracted so the two cannot drift: a shared
 * report that showed different numbers from the private one would be worse than
 * no sharing at all.
 *
 * `contact` is whatever action belongs at the foot of the report — an "email
 * candidate" button for the recruiter, nothing for a public viewer, who is not
 * given the candidate's address.
 */
const RATING_LABELS = {
  technicalSkills: "Technical Skills",
  communication: "Communication",
  problemSolving: "Problem Solving",
  experience: "Experience",
};

function initial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

function ReportBody({ userName, subtitle, report, contact = null }) {
  const feedback = report?.feedback;
  const rating = feedback?.rating ?? {};
  // Previously this summed four ratings without checking they existed, so a
  // partial report rendered as "NaN/10".
  const overall = averageRating(rating);
  const perQuestion = Array.isArray(report?.perQuestion) ? report.perQuestion : [];
  const provenance = ratingProvenance(perQuestion);
  const anyInferred = RATING_KEYS.some((key) => provenance[key] === "inferred");

  return (
    <div className="mt-5">
      <div className="flex justify-between items-center gap-4">
        <div className="flex items-center gap-5">
          <h2 className="bg-primary p-2 px-4.5 font-bold text-white text-sm rounded-full">
            {initial(userName)}
          </h2>
          <div>
            <h2>{(userName ?? "Unknown").toUpperCase()}</h2>
            <h2 className="text-sm text-gray-500">{subtitle}</h2>
          </div>
        </div>
        <h2 className="text-primary text-2xl font-bold">
          {overall === null ? "—" : `${overall}/10`}
        </h2>
      </div>

      <div className="mt-5">
        <h2 className="font-bold">Skills assessment</h2>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {RATING_KEYS.map((key) => (
            <div key={key}>
              <h2 className="flex justify-between text-sm">
                <span>
                  {RATING_LABELS[key]}
                  {provenance[key] === "inferred" && (
                    <span
                      className="ml-1 text-xs text-amber-700"
                      title="No question of this type was asked; this is the overall mean."
                    >
                      *
                    </span>
                  )}
                </span>
                <span>
                  {typeof rating[key] === "number" ? `${rating[key]}/10` : "—"}
                </span>
              </h2>
              <Progress
                value={typeof rating[key] === "number" ? rating[key] * 10 : 0}
                className={"mt-1"}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Ratings are the mean of the per-answer scores below, grouped by
          question type.
          {anyInferred && (
            <>
              {" "}
              <span className="text-amber-700">
                * No question of this type was asked, so the figure shown is the
                overall mean rather than a measurement.
              </span>
            </>
          )}
        </p>
      </div>

      <div className="mt-5">
        <h2 className="font-bold">Performance summary</h2>
        <div className="p-5 bg-secondary my-3 rounded-md">
          <p>{feedback?.summary ?? "No summary was recorded."}</p>
          {report?.summaryGenerated === false && (
            <p className="text-xs text-amber-700 mt-2">
              The written summary could not be generated for this session; the
              scores above are unaffected.
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
                  <p className="text-xs text-gray-600 mt-2">“{answer.transcript}”</p>
                ) : (
                  <p className="text-xs text-gray-500 mt-2">No answer recorded.</p>
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
        className={`p-5 mt-8 rounded-md flex flex-wrap justify-between items-center gap-4 ${
          feedback?.recommendation === "No" ? "bg-red-100" : "bg-green-100"
        }`}
      >
        <div>
          <h2
            className={`font-bold ${
              feedback?.recommendation === "No" ? "text-red-700" : "text-green-700"
            }`}
          >
            Recommendation: {feedback?.recommendation ?? "—"}
          </h2>
          <p className="text-sm">{feedback?.recommendationMsg}</p>
        </div>
        {contact}
      </div>
    </div>
  );
}

export default ReportBody;
