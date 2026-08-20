import test from "node:test";
import assert from "node:assert/strict";
import {
  detectSpeechSupport,
  getSpeechRecognitionCtor,
  transcriptFromEvent,
} from "../lib/speech.js";

class FakeRecognition {}

test("finds the prefixed constructor used by Chromium and Safari", () => {
  assert.equal(
    getSpeechRecognitionCtor({ webkitSpeechRecognition: FakeRecognition }),
    FakeRecognition
  );
  assert.equal(
    getSpeechRecognitionCtor({ SpeechRecognition: FakeRecognition }),
    FakeRecognition
  );
});

test("a browser without recognition (Firefox) is put into typed mode", () => {
  const firefoxLike = { speechSynthesis: {}, SpeechSynthesisUtterance: class {} };
  const support = detectSpeechSupport(firefoxLike);
  assert.deepEqual(support, { recognition: false, synthesis: true, mode: "typed" });
});

test("a browser with recognition stays in voice mode", () => {
  const chromeLike = {
    webkitSpeechRecognition: FakeRecognition,
    speechSynthesis: {},
    SpeechSynthesisUtterance: class {},
  };
  assert.equal(detectSpeechSupport(chromeLike).mode, "voice");
});

test("only final results are kept, so interim guesses do not enter the answer", () => {
  const event = {
    results: [
      { isFinal: true, 0: { transcript: "  A closure is a function " } },
      { isFinal: false, 0: { transcript: "that rememb" } },
      { isFinal: true, 0: { transcript: "that remembers its scope." } },
    ],
  };
  assert.equal(
    transcriptFromEvent(event),
    "A closure is a function that remembers its scope."
  );
});

test("an event with no results yields an empty transcript, not a crash", () => {
  assert.equal(transcriptFromEvent(undefined), "");
  assert.equal(transcriptFromEvent({}), "");
});
