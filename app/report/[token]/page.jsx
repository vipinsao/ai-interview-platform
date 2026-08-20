"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import moment from "moment/moment";
import ReportBody from "@/components/ReportBody";

/**
 * A shared report, for somebody with no account.
 *
 * There is deliberately no Supabase client on this page. The token is sent to
 * an API route which holds the service-role key and returns exactly one report;
 * the browser is never given a key that could read the feedback table.
 */
function SharedReport() {
  const { token } = useParams();
  const [state, setState] = useState({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/report/${token}`);
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setState({
          status: "error",
          message: payload?.error ?? "This report could not be loaded.",
        });
        return;
      }
      setState({ status: "ok", report: payload });
    } catch {
      setState({ status: "error", message: "This report could not be loaded." });
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === "loading") {
    return <p className="p-8 text-gray-500">Loading report…</p>;
  }

  if (state.status === "error") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="font-bold text-2xl">Report unavailable</h1>
        <p className="text-gray-600 mt-2">{state.message}</p>
      </div>
    );
  }

  const { report } = state;

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <h1 className="font-bold text-2xl">
        Interview report{report.jobPosition ? ` — ${report.jobPosition}` : ""}
      </h1>
      <p className="text-sm text-gray-500 mt-1">
        Shared read-only. This link expires{" "}
        {moment(report.expiresAt).format("DD MMM, YYYY")}.
      </p>

      <div className="bg-white rounded-xl border p-4 sm:p-6 mt-5">
        <ReportBody
          userName={report.userName}
          subtitle={`Completed ${moment(report.completedAt).format("DD MMM, YYYY")}`}
          report={report.feedback}
        />
      </div>
    </div>
  );
}

export default SharedReport;
