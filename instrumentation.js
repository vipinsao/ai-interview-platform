/**
 * Runs once when the server process starts (Next.js calls this before it
 * handles any request).
 *
 * The point is to fail loudly at boot with the name of whatever is missing,
 * rather than serving a site that 503s the first time somebody tries to
 * generate questions. A production server refuses to start; a development
 * server prints the list and carries on, so the UI can be toured with the
 * placeholder values .env.example ships with.
 *
 * The build is deliberately exempt: compiling the bundle makes no network calls
 * and needs nobody's secrets.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { assertServerEnv } = await import("./lib/server/config.js");
  assertServerEnv();
}
