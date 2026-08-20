import { Calendar, Clock, DockIcon, Type } from "lucide-react";
import moment from "moment/moment";
import React from "react";

/**
 * `type` is stored as a JSON-encoded array of strings. A plain JSON.parse here
 * threw and blanked the whole page whenever the column held a bare string
 * instead, so parsing is tolerant of both.
 */
function parseInterviewType(type) {
  if (!type) return null;
  if (Array.isArray(type)) return type.join(", ");
  try {
    const parsed = JSON.parse(type);
    return Array.isArray(parsed) ? parsed.join(", ") : String(parsed);
  } catch {
    return String(type);
  }
}

function InterviewDetailContainer({ interviewDetail }) {
  return (
    <div className="p-5 bg-white font-bold rounded-lg mt-5 lg:pr-52">
      <h2>{interviewDetail?.jobPosition}</h2>
      <div className="mt-4 flex items-center justify-between">
        <div>
          <h2 className="text-xs text-gray-500">Duration</h2>
          <h2 className="flex text-md gap-2 font-semibold items-center ">
            <Clock className="h-4 w-4" />
            {interviewDetail?.duration}
          </h2>
        </div>
        <div>
          <h2 className="text-xs text-gray-500">Created On</h2>
          <h2 className="flex text-md gap-2 font-semibold items-center ">
            <Calendar className="h-4 w-4" />
            {moment(interviewDetail?.created_at).format("DD MMM,YYYY")}
          </h2>
        </div>
        {interviewDetail?.type && (
          <div>
            <h2 className="text-xs text-gray-500">Type</h2>
            <h2 className="flex text-md gap-2 font-semibold items-center ">
              <DockIcon className="h-4 w-4" />
              {parseInterviewType(interviewDetail?.type)}
            </h2>
          </div>
        )}
      </div>
      <div className="mt-5">
        <h2 className="font-bold">Job Description</h2>
        <p className="text-gray-500 text-sm leading-6">
          {interviewDetail?.jobDescription}
        </p>
      </div>
      <div className="mt-5">
        <h2 className="font-bold">Interview Questions</h2>
        <div className="grid grid-col-2 gap-3 mt-3 text-gray-500">
          {(interviewDetail?.questionList ?? []).map((item, ind) => (
            <h2 className="text-xs" key={ind}>
              {ind + 1}.{item?.question}
            </h2>
          ))}
        </div>
      </div>
    </div>
  );
}

export default InterviewDetailContainer;
