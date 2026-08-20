import { supabase } from "./supabaseClient";

/** Nothing should be able to hang the UI forever waiting on a model. */
const DEFAULT_TIMEOUT_MS = 45000;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(url, body, { token, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new ApiError(
        response.status,
        payload?.error ?? `Request failed (${response.status})`
      );
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new ApiError(408, "The request timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Candidate-facing endpoints: no account, authorised by the interview link itself. */
export function postJson(url, body, options) {
  return request(url, body, options);
}

/** Recruiter-facing endpoints: sends the Supabase session JWT for the server to verify. */
export async function postWithAuth(url, body, options) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) {
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }
  return request(url, body, { ...options, token });
}
