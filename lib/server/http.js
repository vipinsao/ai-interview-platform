import { NextResponse } from "next/server";

/**
 * API routes previously returned 200 with the raw error object in the body,
 * which meant clients could not tell success from failure and internal error
 * details leaked to the browser. Every failure now carries a real status code
 * and a short message.
 */
export function jsonError(status, message, headers = {}) {
  return NextResponse.json({ error: message }, { status, headers });
}
