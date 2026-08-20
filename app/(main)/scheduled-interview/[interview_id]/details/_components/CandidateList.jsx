import moment from "moment/moment";
import React from "react";
import CandidateFeedbackDialog from "./CandidateFeedbackDialog";

function CandidateList({ candidate }) {
  if (!candidate || candidate.length === 0) {
    return (
      <p className="my-5 text-gray-500">
        No candidate has completed this interview yet.
      </p>
    );
  }

  return (
    <div>
      <h2 className="font-bold my-5">Candidates ({candidate?.length})</h2>
      {candidate?.map((candidate, ind) => (
        <div
          key={ind}
          className="p-5 flex justify-between gap-3 items-center bg-white rounded-lg"
        >
          <div className="flex item-center gap-5">
            <h2 className="bg-primary p-2 px-4.5 font-bold text-white text-sm rounded-full">
              {candidate.userName[0].toUpperCase()}
            </h2>
            <div>
              <h2>{candidate?.userName.toUpperCase()}</h2>
              <h2 className="text-sm text-gray-500">
                Completed On:{" "}
                {moment(candidate?.created_at).format("DD MMM,YYYY")}
              </h2>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {/* <h2 className="text-sm text-green-500">{total / 4}/10</h2> */}
            <CandidateFeedbackDialog candidate={candidate} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default CandidateList;
