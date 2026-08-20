/**
 * Verifying the caller of an API route.
 *
 * The browser holds a Supabase-issued JWT after Google sign-in. Route handlers
 * do not trust any identity in the request body; they take the bearer token and
 * ask Supabase to verify it, and use the user id it returns. Before this, the
 * generation endpoints were open to the internet and anyone could spend the
 * project's LLM budget.
 */
import { serverAnonClient } from "./supabase.js";

export function bearerToken(request) {
  const header = request?.headers?.get?.("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** @returns {Promise<{id: string, email: string}|null>} */
export async function getUserFromRequest(request) {
  const token = bearerToken(request);
  if (!token) return null;

  const { data, error } = await serverAnonClient().auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
}
