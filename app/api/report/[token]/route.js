/**
 * A shared report, for somebody with no account.
 *
 * The token in the URL is the entire credential, so this route does one thing:
 * look up the single row whose share_token equals it. There is no listing
 * endpoint and no way to widen the query, which is what keeps one leaked link
 * from becoming access to every report in the project.
 */
import { NextResponse } from "next/server";

import { MissingConfigError } from "@/lib/server/env";
import { jsonError } from "@/lib/server/http";
import { findSharedReport } from "@/lib/server/reports";

export async function GET(_request, { params }) {
  const { token } = await params;

  try {
    const result = await findSharedReport(token);

    if (!result) {
      return jsonError(404, "This report link is not valid.");
    }
    if (result.expired) {
      // Worth distinguishing: the holder of an expired link needs to know to
      // ask for a new one, and confirming that a 122-bit token once existed
      // tells an attacker nothing they could act on.
      return jsonError(410, "This report link has expired. Ask for a new one.");
    }

    return NextResponse.json(result.report, {
      // A shared report must not sit in a shared cache.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error("[report]", error.message);
      return jsonError(503, "This report is temporarily unavailable.");
    }
    console.error("[report] unexpected failure:", error);
    return jsonError(500, "This report is temporarily unavailable.");
  }
}
