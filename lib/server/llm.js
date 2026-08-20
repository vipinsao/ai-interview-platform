/**
 * The one place the app talks to a language model.
 *
 * Groq is the default because its developer tier is free with no card and no
 * credit balance, and its latency is low enough for a voice loop where the
 * candidate is waiting. It exposes an OpenAI-compatible API, so the official
 * openai client works against it unchanged. Any other OpenAI-compatible
 * provider can be used by overriding LLM_BASE_URL and LLM_MODEL.
 */
import OpenAI from "openai";
import { parseModelJson } from "../aiJson.js";
import { requireEnv } from "./env.js";

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const REQUEST_TIMEOUT_MS = 30_000;

export class StructuredOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

export function llmModel() {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

export function getLlmClient() {
  const apiKey = requireEnv(
    "LLM_API_KEY",
    "Create a free Groq API key at https://console.groq.com/keys."
  );
  return new OpenAI({
    apiKey,
    baseURL: process.env.LLM_BASE_URL || DEFAULT_BASE_URL,
    // Without a timeout a stalled provider hangs the request until the
    // platform kills it, which the candidate sees as a frozen interview.
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });
}

/**
 * Ask the model for JSON and return it only if it validates against `schema`.
 *
 * One corrective retry: the rejected reply and the reason are fed back, which
 * fixes the common case of a model adding prose or dropping a field. A second
 * failure throws, and the caller decides how to degrade.
 *
 * @param {{system: string, prompt: string, schema: import("zod").ZodTypeAny}} args
 */
export async function completeStructured({ system, prompt, schema }) {
  const client = getLlmClient();
  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];

  let lastError = "the model returned nothing";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completion = await client.chat.completions.create({
      model: llmModel(),
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = parseModelJson(raw);

    if (parsed.ok) {
      const validated = schema.safeParse(parsed.value);
      if (validated.success) return validated.data;
      lastError = validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
    } else {
      lastError = parsed.error;
    }

    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `That reply was rejected (${lastError}). Reply with JSON only, matching the requested shape exactly, with no commentary.`,
    });
  }

  throw new StructuredOutputError(
    `model output failed validation twice: ${lastError}`
  );
}
