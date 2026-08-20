/**
 * Mints, reuses or revokes the share link for one candidate report.
 *
 * Recruiter-only: the caller's identity comes from the verified Supabase JWT,
 * and the report must belong to an interview they own. A report id that exists
 * but belongs to someone else is answered exactly like one that does not exist.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserFromRequest } from "@/lib/server/auth";
import { MissingConfigError } from "@/lib/server/env";
import { jsonError } from "@/lib/server/http";
import {
  findOwnedFeedback,
  issueShareLink,
  revokeShareLink,
} from "@/lib/server/reports";

const requestSchema = z.object({
  feedbackId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  revoke: z.boolean().default(false),
});

export async function POST(request) {
  const user = await getUserFromRequest(request);
  if (!user) return jsonError(401, "Sign in to share a report.");

  let body;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return jsonError(400, "Provide the report id.");
  }

  try {
    const feedback = await findOwnedFeedback(Number(body.feedbackId), user.email);
    if (!feedback) {
      return jsonError(404, "That report does not exist, or it is not yours.");
    }

    if (body.revoke) {
      await revokeShareLink(feedback.id);
      return NextResponse.json({ revoked: true });
    }

    const link = await issueShareLink(feedback);
    return NextResponse.json({ token: link.token, expiresAt: link.expiresAt });
  } catch (error) {
    if (error instanceof MissingConfigError) {
      console.error("[share]", error.message);
      return jsonError(503, "Sharing is temporarily unavailable.");
    }
    console.error("[share] unexpected failure:", error);
    return jsonError(500, "That report could not be shared.");
  }
}
