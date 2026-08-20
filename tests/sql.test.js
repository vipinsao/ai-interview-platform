/**
 * Exercises supabase/schema.sql against a real PostgreSQL server.
 *
 * These are the tests for the things that cannot be checked in JavaScript: that
 * a browser cannot write the credits column, that the rate limiter is atomic
 * under concurrency, and that a replayed PayPal order grants nothing. Each one
 * runs the actual schema file, so it also proves the file applies cleanly.
 *
 * Skipped unless TEST_DATABASE_URL is set, because CI has no database.
 * supabase/README.md has a copy-paste way to get one for free, without root.
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres \
 *     npm test
 *
 * WARNING: the suite drops and recreates the public schema. Point it at a
 * throwaway database, never at your Supabase project.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decisionFromRow, evaluateRateLimit } from "../lib/rateLimit.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const CONNECTION = process.env.TEST_DATABASE_URL;
const skip = CONNECTION
  ? false
  : "set TEST_DATABASE_URL to run the database tests (see supabase/README.md)";

const RECRUITER = "recruiter@example.com";
const OTHER = "other@example.com";

/** Runs `fn` with the connection acting as a Supabase client role. */
async function asRole(client, role, email, fn) {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    if (email) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ email, role }),
      ]);
    }
    return await fn();
  } finally {
    await client.query("rollback").catch(() => {});
  }
}

/** Postgres error code for a statement the role is not privileged to run. */
const INSUFFICIENT_PRIVILEGE = "42501";

describe("supabase/schema.sql", { skip }, () => {
  let pool;

  before(async () => {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: CONNECTION, max: 24 });

    const setup = await pool.connect();
    try {
      await setup.query(readFileSync(join(root, "tests/sql/supabase-shim.sql"), "utf8"));
      await setup.query(readFileSync(join(root, "supabase/schema.sql"), "utf8"));
      await setup.query(
        `insert into public."Users" (name, email, credits) values
           ('Recruiter', $1, 3), ('Other', $2, 3)`,
        [RECRUITER, OTHER]
      );
    } finally {
      setup.release();
    }
  });

  after(async () => {
    if (pool) await pool.end();
  });

  // ---------------------------------------------------------------------------
  // The credit vulnerability
  // ---------------------------------------------------------------------------

  it("a signed-in user cannot award themselves credits", async () => {
    const client = await pool.connect();
    try {
      await asRole(client, "authenticated", RECRUITER, async () => {
        await assert.rejects(
          () =>
            client.query(
              `update public."Users" set credits = 999999 where email = $1`,
              [RECRUITER]
            ),
          (error) => error.code === INSUFFICIENT_PRIVILEGE,
          "the exact attack: an authenticated user updating their own row"
        );
      });
    } finally {
      client.release();
    }
  });

  it("a signed-in user cannot smuggle credits into a profile insert", async () => {
    const client = await pool.connect();
    try {
      await asRole(client, "authenticated", "new@example.com", async () => {
        await assert.rejects(
          () =>
            client.query(
              `insert into public."Users" (name, email, credits) values ('New', $1, 500)`,
              ["new@example.com"]
            ),
          (error) => error.code === INSUFFICIENT_PRIVILEGE
        );
      });
    } finally {
      client.release();
    }
  });

  it("a signed-in user can still edit the profile fields they own", async () => {
    const client = await pool.connect();
    try {
      await asRole(client, "authenticated", RECRUITER, async () => {
        const { rowCount } = await client.query(
          `update public."Users" set name = 'Renamed' where email = $1`,
          [RECRUITER]
        );
        assert.equal(rowCount, 1, "revoking credits must not lock the whole row");
      });
    } finally {
      client.release();
    }
  });

  it("the anon role cannot read or write anything", async () => {
    const client = await pool.connect();
    try {
      await asRole(client, "anon", null, async () => {
        for (const table of ['"Users"', '"Interviews"', '"interview-feedback"', "rate_limits", "credit_purchases"]) {
          // Each probe gets its own savepoint: the first denial aborts the
          // transaction, and everything after it would fail for the wrong reason.
          await client.query("savepoint probe");
          await assert.rejects(
            () => client.query(`select * from public.${table} limit 1`),
            (error) => error.code === INSUFFICIENT_PRIVILEGE,
            `anon could read ${table}`
          );
          await client.query("rollback to savepoint probe");
        }
      });
    } finally {
      client.release();
    }
  });

  it("only the service role may grant credits or consume the rate limit", async () => {
    const client = await pool.connect();
    try {
      await asRole(client, "authenticated", RECRUITER, async () => {
        await client.query("savepoint probe");
        await assert.rejects(
          () =>
            client.query(
              "select * from public.grant_purchased_credits($1,$2,$3,$4,$5,$6)",
              ["FORGED", RECRUITER, 500, "5.00", "USD", null]
            ),
          (error) => error.code === INSUFFICIENT_PRIVILEGE,
          "a browser must not be able to call the function that adds credits"
        );
        await client.query("rollback to savepoint probe");

        await assert.rejects(
          () => client.query("select * from public.consume_rate_limit($1,$2,$3)", ["k", 5, 1000]),
          (error) => error.code === INSUFFICIENT_PRIVILEGE
        );
      });
    } finally {
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  // Idempotent credit granting
  // ---------------------------------------------------------------------------

  it("replaying the same PayPal order id grants credits only once", async () => {
    const orderId = "REPLAY-ORDER-1";
    const before = await creditsOf(pool, RECRUITER);

    const first = await grant(pool, orderId, RECRUITER, 20);
    const second = await grant(pool, orderId, RECRUITER, 20);

    assert.equal(first.granted, true);
    assert.equal(second.granted, false, "the replay must not grant a second time");
    assert.equal(first.credits_total, before + 20);
    assert.equal(second.credits_total, before + 20, "balance unchanged by the replay");
    assert.equal(await creditsOf(pool, RECRUITER), before + 20);

    const { rows } = await pool.query(
      "select count(*)::int as n from public.credit_purchases where paypal_order_id = $1",
      [orderId]
    );
    assert.equal(rows[0].n, 1, "one order id, one ledger row");
  });

  it("twelve simultaneous captures of one order id grant exactly one lot of credits", async () => {
    const orderId = "REPLAY-ORDER-CONCURRENT";
    const before = await creditsOf(pool, RECRUITER);

    const results = await Promise.all(
      Array.from({ length: 12 }, () => grant(pool, orderId, RECRUITER, 50))
    );

    const granted = results.filter((row) => row.granted).length;
    assert.equal(granted, 1, "exactly one concurrent caller may win the insert");
    assert.equal(await creditsOf(pool, RECRUITER), before + 50);
  });

  it("granting refuses a non-positive amount of credits", async () => {
    await assert.rejects(
      () => grant(pool, "BAD-ORDER", RECRUITER, 0),
      /positive/
    );
  });

  it("granting to an unknown user fails rather than silently doing nothing", async () => {
    await assert.rejects(
      () => grant(pool, "UNKNOWN-USER-ORDER", "nobody@example.com", 10),
      /no Users row/
    );
    const { rows } = await pool.query(
      "select count(*)::int as n from public.credit_purchases where paypal_order_id = $1",
      ["UNKNOWN-USER-ORDER"]
    );
    assert.equal(rows[0].n, 0, "the ledger row must roll back with the grant");
  });

  // ---------------------------------------------------------------------------
  // Atomic rate limiting
  // ---------------------------------------------------------------------------

  it("read-then-write admits two racing requests — the bug this replaces", async () => {
    // Deterministic re-enactment of the old lib/server/rateLimit.js: both
    // connections read before either writes, so both see count 0.
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      const key = "old-implementation";
      const read = async (client) => {
        const { rows } = await client.query(
          "select count from public.rate_limits where key = $1",
          [key]
        );
        return rows[0]?.count ?? 0;
      };
      const countA = await read(a);
      const countB = await read(b);
      const limit = 1;

      assert.equal(countA < limit, true);
      assert.equal(countB < limit, true, "both requests were admitted against a limit of 1");

      await a.query(
        "insert into public.rate_limits (key, window_start, count) values ($1, now(), $2) on conflict (key) do update set count = $2",
        [key, countA + 1]
      );
      await b.query(
        "insert into public.rate_limits (key, window_start, count) values ($1, now(), $2) on conflict (key) do update set count = $2",
        [key, countB + 1]
      );

      const { rows } = await a.query("select count from public.rate_limits where key = $1", [key]);
      assert.equal(rows[0].count, 1, "two admitted requests, and the counter only records one");
    } finally {
      a.release();
      b.release();
    }
  });

  it("consume_rate_limit admits exactly the limit under 24-way concurrency", async () => {
    const key = "concurrent-limit";
    const limit = 8;

    const results = await Promise.all(
      Array.from({ length: 24 }, () =>
        pool
          .query("select * from public.consume_rate_limit($1, $2, $3)", [key, limit, 60000])
          .then((r) => r.rows[0])
      )
    );

    const allowed = results.filter((row) => row.allowed).length;
    assert.equal(allowed, limit, `expected exactly ${limit} admitted, got ${allowed}`);

    const { rows } = await pool.query("select count from public.rate_limits where key = $1", [key]);
    assert.equal(rows[0].count, limit + 1, "the stored counter is capped at limit + 1");
  });

  it("consume_rate_limit reports the same decision shape the headers need", async () => {
    const key = "decision-shape";
    const first = await consume(pool, key, 2, 60000);
    assert.equal(first.allowed, true);
    assert.equal(first.hit_count, 1);
    assert.equal(first.reset_at - first.window_started_at, 60000);

    const second = await consume(pool, key, 2, 60000);
    assert.equal(second.allowed, true);
    assert.equal(second.hit_count, 2);

    const third = await consume(pool, key, 2, 60000);
    assert.equal(third.allowed, false);
    assert.equal(third.hit_count, 3);
  });

  it("consume_rate_limit starts a fresh window once the old one has elapsed", async () => {
    const key = "window-rollover";
    const t0 = new Date("2026-01-01T00:00:00Z");
    const inWindow = new Date("2026-01-01T00:00:30Z");
    const afterWindow = new Date("2026-01-01T00:01:00Z");

    assert.equal((await consume(pool, key, 1, 60000, t0)).allowed, true);
    assert.equal((await consume(pool, key, 1, 60000, inWindow)).allowed, false);

    const rolled = await consume(pool, key, 1, 60000, afterWindow);
    assert.equal(rolled.allowed, true, "a new window admits again");
    assert.equal(rolled.hit_count, 1);
    assert.equal(rolled.window_started_at.getTime(), afterWindow.getTime());
  });

  it("consume_rate_limit agrees with the JavaScript reference model", async () => {
    // lib/rateLimit.js states the fixed-window rule in a form a reader can
    // check. This runs both over the same sequence and fails if they drift.
    const key = "differential";
    const limit = 3;
    const windowMs = 60_000;
    const start = Date.parse("2026-03-01T12:00:00Z");
    const offsets = [0, 1_000, 2_000, 3_000, 59_999, 60_000, 60_001];

    let modelWindowStart = null;
    let modelCount = 0;

    for (const offset of offsets) {
      const now = start + offset;
      const expected = evaluateRateLimit({
        now,
        windowStart: modelWindowStart,
        count: modelCount,
        limit,
        windowMs,
      });
      modelWindowStart = expected.windowStart;
      modelCount = expected.count;

      const actual = decisionFromRow(
        await consume(pool, key, limit, windowMs, new Date(now)),
        { limit, now }
      );

      assert.equal(actual.allowed, expected.allowed, `allowed differs at +${offset}ms`);
      assert.equal(actual.remaining, expected.remaining, `remaining differs at +${offset}ms`);
      assert.equal(actual.windowStart, expected.windowStart, `window differs at +${offset}ms`);
      assert.equal(actual.resetAt, expected.resetAt, `reset differs at +${offset}ms`);
    }
  });

  // ---------------------------------------------------------------------------
  // Spending a credit and creating an interview
  // ---------------------------------------------------------------------------

  it("create_interview spends exactly one credit and files the row to the caller", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ email: RECRUITER }),
      ]);
      const before = (
        await client.query(`select credits from public."Users" where email = $1`, [RECRUITER])
      ).rows[0].credits;

      const id = "11111111-1111-4111-8111-111111111111";
      const { rows } = await client.query(
        "select public.create_interview($1,$2,$3,$4,$5,$6) as id",
        ["Dev", "Builds things", "15 min", '["Technical"]', JSON.stringify([]), id]
      );
      assert.equal(rows[0].id, id);

      const after = (
        await client.query(`select credits from public."Users" where email = $1`, [RECRUITER])
      ).rows[0].credits;
      assert.equal(after, before - 1);

      const owner = (
        await client.query(`select "userEmail" from public."Interviews" where interview_id = $1`, [id])
      ).rows[0].userEmail;
      assert.equal(owner, RECRUITER, "ownership comes from the JWT, not from an argument");

      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("a failed create_interview leaves the credit unspent", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ email: RECRUITER }),
      ]);

      const id = "22222222-2222-4222-8222-222222222222";
      const args = ["Dev", "Builds things", "15 min", '["Technical"]', JSON.stringify([]), id];
      await client.query("select public.create_interview($1,$2,$3,$4,$5,$6)", args);

      const before = (
        await client.query(`select credits from public."Users" where email = $1`, [RECRUITER])
      ).rows[0].credits;

      // Same interview_id: the insert violates the unique constraint, so the
      // credit spent moments earlier in the same call must roll back with it.
      await client.query("savepoint attempt");
      await assert.rejects(
        () => client.query("select public.create_interview($1,$2,$3,$4,$5,$6)", args),
        (error) => error.code === "23505"
      );
      await client.query("rollback to savepoint attempt");

      const after = (
        await client.query(`select credits from public."Users" where email = $1`, [RECRUITER])
      ).rows[0].credits;
      assert.equal(after, before, "the failed call must not charge a credit");

      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("create_interview refuses when the balance is empty", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ email: OTHER }),
      ]);
      await client.query("set local role postgres");
      await client.query(`update public."Users" set credits = 0 where email = $1`, [OTHER]);
      await client.query("set local role authenticated");

      await assert.rejects(
        () =>
          client.query("select public.create_interview($1,$2,$3,$4,$5,$6)", [
            "Dev",
            "Builds things",
            "15 min",
            '["Technical"]',
            JSON.stringify([]),
            "33333333-3333-4333-8333-333333333333",
          ]),
        /no interview credits remaining/
      );
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("create_interview refuses an unauthenticated caller", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await assert.rejects(
        () =>
          client.query("select public.create_interview($1,$2,$3,$4,$5,$6)", [
            "Dev",
            "Builds things",
            "15 min",
            '["Technical"]',
            JSON.stringify([]),
            "44444444-4444-4444-8444-444444444444",
          ]),
        /not authenticated/
      );
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  // Candidate sessions and issued scores
  // ---------------------------------------------------------------------------

  it("a score is written once and cannot be improved by resubmitting", async () => {
    const token = await startSession(pool, "77777777-7777-4777-8777-777777777777");

    const first = await recordScore(pool, token, 0, 6);
    assert.equal(first.recorded, true);
    assert.equal(Number(first.final_score), 6);

    // The attack: answer again and again until the model returns a ten.
    const second = await recordScore(pool, token, 0, 10);
    assert.equal(second.recorded, false, "a second score must not replace the first");
    assert.equal(Number(second.final_score), 6, "the caller is told the stored figure");

    const { rows } = await pool.query(
      "select score from public.answer_scores where session_token = $1 and question_index = 0",
      [token]
    );
    assert.equal(Number(rows[0].score), 6);
  });

  it("an answer the model could not score may be scored by a retry", async () => {
    const token = await startSession(pool, "88888888-8888-4888-8888-888888888888");

    const failed = await recordScore(pool, token, 0, null);
    assert.equal(failed.recorded, true);
    assert.equal(failed.final_score, null);

    const retried = await recordScore(pool, token, 0, 7);
    assert.equal(retried.recorded, true, "a null score is the one case that may be overwritten");
    assert.equal(Number(retried.final_score), 7);

    // ...and once it is a real score, it is closed again.
    const third = await recordScore(pool, token, 0, 10);
    assert.equal(third.recorded, false);
    assert.equal(Number(third.final_score), 7);
  });

  it("twelve simultaneous submissions of one answer record exactly one score", async () => {
    const token = await startSession(pool, "99999999-9999-4999-8999-999999999999");

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => recordScore(pool, token, 0, 1 + i * 0.5))
    );

    assert.equal(
      results.filter((row) => row.recorded).length,
      1,
      "exactly one concurrent caller may set the score"
    );
    const { rows } = await pool.query(
      "select count(*)::int as n from public.answer_scores where session_token = $1",
      [token]
    );
    assert.equal(rows[0].n, 1);
  });

  it("a browser can neither read sessions and scores nor call the function that writes them", async () => {
    const token = await startSession(pool, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const client = await pool.connect();
    try {
      for (const role of ["anon", "authenticated"]) {
        await asRole(client, role, RECRUITER, async () => {
          for (const table of ["interview_sessions", "answer_scores"]) {
            await client.query("savepoint probe");
            await assert.rejects(
              () => client.query(`select * from public.${table} limit 1`),
              (error) => error.code === INSUFFICIENT_PRIVILEGE,
              `${role} could read ${table}`
            );
            await client.query("rollback to savepoint probe");
          }

          await assert.rejects(
            () =>
              client.query(
                "select * from public.record_answer_score($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                [token, 0, "q", "Technical", "t", 10, "[]", "[]", ""]
              ),
            (error) => error.code === INSUFFICIENT_PRIVILEGE,
            `${role} could write its own score`
          );
        });
      }
    } finally {
      client.release();
    }
  });

  it("deleting an interview takes its sessions and scores with it", async () => {
    const interviewId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const token = await startSession(pool, interviewId);
    await recordScore(pool, token, 0, 5);

    await pool.query(`delete from public."Interviews" where interview_id = $1`, [interviewId]);

    for (const table of ["interview_sessions", "answer_scores"]) {
      const { rows } = await pool.query(
        `select count(*)::int as n from public.${table} where session_token = $1`,
        [token]
      );
      assert.equal(rows[0].n, 0, `${table} kept an orphan row`);
    }
  });

  // ---------------------------------------------------------------------------
  // Share tokens
  // ---------------------------------------------------------------------------

  it("a share token resolves to at most one report", async () => {
    const interviewId = "55555555-5555-4555-8555-555555555555";
    await pool.query(
      `insert into public."Interviews" ("jobPosition","jobDescription",duration,type,"questionList","userEmail",interview_id)
       values ('Dev','Builds things','15 min','["Technical"]','[]'::jsonb,$1,$2)`,
      [RECRUITER, interviewId]
    );
    const token = "66666666-6666-4666-8666-666666666666";
    await pool.query(
      `insert into public."interview-feedback" ("userName", interview_id, feedback, share_token)
       values ('Candidate', $1, '{}'::jsonb, $2)`,
      [interviewId, token]
    );

    await assert.rejects(
      () =>
        pool.query(
          `insert into public."interview-feedback" ("userName", interview_id, feedback, share_token)
           values ('Another', $1, '{}'::jsonb, $2)`,
          [interviewId, token]
        ),
      (error) => error.code === "23505",
      "two reports must never share a token"
    );

    // Rows that were never shared do not collide with each other.
    for (const name of ["A", "B"]) {
      await pool.query(
        `insert into public."interview-feedback" ("userName", interview_id, feedback)
         values ($1, $2, '{}'::jsonb)`,
        [name, interviewId]
      );
    }
  });
});

async function grant(pool, orderId, email, credits) {
  const { rows } = await pool.query(
    "select * from public.grant_purchased_credits($1,$2,$3,$4,$5,$6)",
    [orderId, email, credits, "5.00", "USD", "CAPTURE-1"]
  );
  return rows[0];
}

async function consume(pool, key, limit, windowMs, now) {
  const { rows } = await pool.query(
    now
      ? "select * from public.consume_rate_limit($1,$2,$3,$4)"
      : "select * from public.consume_rate_limit($1,$2,$3)",
    now ? [key, limit, windowMs, now] : [key, limit, windowMs]
  );
  return rows[0];
}

async function creditsOf(pool, email) {
  const { rows } = await pool.query(`select credits from public."Users" where email = $1`, [email]);
  return rows[0].credits;
}

/** Creates an interview and a candidate session on it, returning the token. */
async function startSession(pool, interviewId) {
  await pool.query(
    `insert into public."Interviews" ("jobPosition","jobDescription",duration,type,"questionList","userEmail",interview_id)
     values ('Dev','Builds things','15 min','["Technical"]','[]'::jsonb,$1,$2)`,
    [RECRUITER, interviewId]
  );
  const { rows } = await pool.query(
    `insert into public.interview_sessions (interview_id, user_name, user_email)
     values ($1, 'Candidate', 'candidate@example.com') returning session_token`,
    [interviewId]
  );
  return rows[0].session_token;
}

async function recordScore(pool, token, index, score) {
  const { rows } = await pool.query(
    "select * from public.record_answer_score($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [token, index, "Explain event loops.", "Technical", "an answer", score, "[]", "[]", ""]
  );
  return rows[0];
}
