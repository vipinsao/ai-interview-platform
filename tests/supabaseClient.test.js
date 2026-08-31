/**
 * The browser client must be importable without configuration.
 *
 * `Provider` is mounted in the root layout and imports `services/supabaseClient`,
 * so every route imports it transitively. While that module threw at import
 * time, `next build` failed prerendering `/_not-found` — a page that never
 * touches Supabase — and a fresh clone could not be built at all without first
 * creating a Supabase project.
 *
 * The guard itself is not the problem and is asserted below: it still fires,
 * with the same message, on the first real use. These tests are the difference
 * between "mandatory to run" and "mandatory to build", made checkable.
 *
 * Order matters here. The module caches the client after a successful build, so
 * the unconfigured case has to run first.
 */
import test from "node:test";
import assert from "node:assert/strict";

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const mod = await import("../services/supabaseClient.js");

test("importing the module with no configuration does not throw", () => {
  // The regression: this import is what `next build` performs for every route.
  assert.equal(typeof mod.supabase, "object");
  assert.equal(typeof mod.getSupabase, "function");
});

test("using it with no configuration still throws, naming both variables", () => {
  assert.throws(
    () => mod.supabase.auth,
    (err) =>
      err instanceof Error &&
      err.message.includes("NEXT_PUBLIC_SUPABASE_URL") &&
      err.message.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
      err.message.includes(".env.example")
  );
});

test("once configured it constructs, and reuses one client", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-tests";

  const first = mod.getSupabase();
  assert.ok(first, "a client is returned once the variables are set");
  assert.equal(mod.getSupabase(), first, "the client is cached, not rebuilt");

  // The facade reaches the same instance the getter does.
  assert.equal(typeof mod.supabase.from, "function");
  assert.equal(mod.supabase.auth, first.auth);
});
