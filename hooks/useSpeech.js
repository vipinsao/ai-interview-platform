"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectSpeechSupport,
  getSpeechRecognitionCtor,
  transcriptFromEvent,
} from "@/lib/speech";

/**
 * Browser plumbing for the Web Speech API: speech synthesis reads the question
 * out, speech recognition captures the answer. No SDK, no API key, no cost.
 *
 * Support is detected at runtime rather than assumed — Firefox has no speech
 * recognition at all, and Chromium and Safari expose it under the webkit
 * prefix. The caller falls back to typed answers when `support.recognition`
 * is false.
 */
export function useSpeech() {
  // Starts pessimistic and is filled in after mount, so the server-rendered
  // markup and the first client render agree.
  const [support, setSupport] = useState({
    recognition: false,
    synthesis: false,
    mode: "typed",
    ready: false,
  });

  const recognitionRef = useRef(null);

  useEffect(() => {
    setSupport({ ...detectSpeechSupport(window), ready: true });
  }, []);

  /** Resolves once the utterance finishes, or immediately if unsupported. */
  const speak = useCallback((text) => {
    return new Promise((resolve) => {
      if (!text || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        resolve(false);
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  /**
   * Opens the microphone until the candidate stops talking for `silenceMs`.
   * Always resolves — a rejected promise here would surface as an unhandled
   * rejection and a frozen interview.
   *
   * @returns {Promise<{ok: true, transcript: string} | {ok: false, reason: string}>}
   */
  const listen = useCallback(({ silenceMs = 10000 } = {}) => {
    return new Promise((resolve) => {
      const Recognition = getSpeechRecognitionCtor(window);
      if (!Recognition) {
        resolve({ ok: false, reason: "unsupported" });
        return;
      }

      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;

      let transcript = "";
      let settled = false;
      let timer = null;

      const stopSoon = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          try {
            recognition.stop();
          } catch {
            /* already stopped */
          }
        }, silenceMs);
      };

      const settle = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        recognitionRef.current = null;
        resolve(result);
      };

      recognition.onresult = (event) => {
        const heard = transcriptFromEvent(event);
        if (heard) transcript = heard;
        stopSoon();
      };
      recognition.onerror = (event) =>
        settle({ ok: false, reason: event?.error ?? "recognition-error" });
      recognition.onend = () => settle({ ok: true, transcript });

      try {
        recognition.start();
        stopSoon();
      } catch {
        settle({ ok: false, reason: "start-failed" });
      }
    });
  }, []);

  /** Ends the current utterance and microphone session, e.g. when leaving the page. */
  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* already finished */
      }
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  return { support, speak, listen, cancel };
}
