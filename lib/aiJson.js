/**
 * Turning a language-model reply into a JavaScript value.
 *
 * Models are asked for JSON but routinely wrap it in ``` fences or bolt a
 * sentence on the front. Calling JSON.parse directly on the reply therefore
 * throws on perfectly ordinary output, so every call site goes through
 * parseModelJson, which never throws and reports failure as a value.
 */

const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

/**
 * Pull the most likely JSON payload out of a model reply.
 * Returns null when there is nothing that could plausibly be JSON.
 */
export function extractJsonBlock(text) {
  if (typeof text !== "string") return null;

  const fenced = text.match(FENCE);
  const candidate = fenced ? fenced[1] : text;

  const objectStart = candidate.indexOf("{");
  const arrayStart = candidate.indexOf("[");
  const starts = [objectStart, arrayStart].filter((i) => i !== -1);
  if (starts.length === 0) return null;

  const start = Math.min(...starts);
  const closer = candidate[start] === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(closer);
  if (end <= start) return null;

  return candidate.slice(start, end + 1).trim();
}

/**
 * Parse a model reply. Always returns a result object, never throws.
 * { ok: true, value } | { ok: false, error }
 */
export function parseModelJson(text) {
  const block = extractJsonBlock(text);
  if (block === null) {
    return { ok: false, error: "no JSON found in model reply" };
  }
  try {
    return { ok: true, value: JSON.parse(block) };
  } catch (err) {
    return { ok: false, error: `model reply was not valid JSON: ${err.message}` };
  }
}
