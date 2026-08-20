/**
 * Startup configuration checks.
 *
 * The README claimed the app "throws on startup naming anything that is
 * missing". Before this module nothing ran at import: a deployment with no
 * service-role key started happily and failed on the first request that needed
 * it. These tests are the claim, made checkable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertServerEnv, missingEnv, StartupConfigError } from "../lib/server/config.js";

const COMPLETE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  LLM_API_KEY: "llm",
  NEXT_PUBLIC_HOST_URL: "http://localhost:3000",
};

test("a complete environment passes", () => {
  assert.deepEqual(missingEnv(COMPLETE), []);
  assert.doesNotThrow(() => assertServerEnv(COMPLETE, "production"));
});

test("a development server starts anyway, so the UI can be toured", () => {
  // `cp .env.example .env.local && npm run dev` ships placeholder Supabase
  // values and nothing else. That must render the product, not a 500.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    assert.doesNotThrow(() =>
      assertServerEnv(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder-anon-key",
        },
        "development"
      )
    );
  } finally {
    console.warn = realWarn;
  }

  assert.equal(warnings.length, 1, "it must still say what is missing");
  assert.match(warnings[0], /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(warnings[0], /LLM_API_KEY/);
});

test("every missing variable is named, not just the first", () => {
  const missing = missingEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" });
  const names = missing.map((entry) => entry.name);

  assert.deepEqual(names, [
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "LLM_API_KEY",
    "NEXT_PUBLIC_HOST_URL",
  ]);
  for (const entry of missing) {
    assert.equal(entry.hint.length > 0, true, `${entry.name} must say where to get the value`);
  }
});

test("a variable set to whitespace counts as missing", () => {
  const missing = missingEnv({ ...COMPLETE, LLM_API_KEY: "   " });
  assert.deepEqual(
    missing.map((entry) => entry.name),
    ["LLM_API_KEY"]
  );
});

test("a production server refuses to start, naming every missing variable", () => {
  let error = null;
  try {
    assertServerEnv({}, "production");
  } catch (thrown) {
    error = thrown;
  }
  assert.equal(error instanceof StartupConfigError, true);
  for (const name of Object.keys(COMPLETE)) {
    assert.match(error.message, new RegExp(name), `${name} is not in the message`);
  }
  assert.equal(error.missing.length, 5);
});

test("billing is optional when none of it is configured", () => {
  assert.deepEqual(missingEnv(COMPLETE), []);
});

test("billing configured halfway is refused, because it fails at the till", () => {
  const missing = missingEnv({ ...COMPLETE, NEXT_PUBLIC_PAYPAL_CLIENT_ID: "client" });
  assert.deepEqual(
    missing.map((entry) => entry.name),
    ["PAYPAL_CLIENT_SECRET"]
  );
  assert.match(missing[0].hint, /half-configured/);
});

test("billing configured fully passes", () => {
  assert.deepEqual(
    missingEnv({
      ...COMPLETE,
      NEXT_PUBLIC_PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "secret",
    }),
    []
  );
});
