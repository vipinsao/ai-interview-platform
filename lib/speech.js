/**
 * Feature detection for the browser-native Web Speech API.
 *
 * Recognition ships prefixed in Chromium and Safari and is absent in Firefox,
 * so support is detected at runtime and the caller falls back to typed
 * answers. The window object is a parameter so this is testable off a browser.
 */

export function getSpeechRecognitionCtor(win) {
  if (!win) return null;
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function isSpeechSynthesisSupported(win) {
  return Boolean(win && win.speechSynthesis && win.SpeechSynthesisUtterance);
}

/**
 * @returns {{recognition: boolean, synthesis: boolean, mode: "voice"|"typed"}}
 * Recognition is what decides the mode: without it the candidate cannot answer
 * by voice at all, whereas a missing speech synthesis only means the question
 * is read rather than heard.
 */
export function detectSpeechSupport(win) {
  const recognition = getSpeechRecognitionCtor(win) !== null;
  const synthesis = isSpeechSynthesisSupported(win);
  return { recognition, synthesis, mode: recognition ? "voice" : "typed" };
}

/**
 * Flatten a SpeechRecognition result event into a single transcript.
 * Only final results are kept; interim guesses are noisy and get revised.
 */
export function transcriptFromEvent(event) {
  const results = event?.results;
  if (!results) return "";
  const parts = [];
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (!result || result.isFinal === false) continue;
    const alternative = result[0];
    if (alternative?.transcript) parts.push(alternative.transcript.trim());
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
