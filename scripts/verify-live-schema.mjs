/**
 * Checks that a LIVE database actually has the protections supabase/schema.sql
 * describes. Read-only: it runs SELECTs against catalogue views and writes
 * nothing.
 *
 *   DATABASE_URL="postgres://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres" \
 *     npm run verify:db
 *
 * Why this exists rather than a CI job: CI has no route to the production
 * database, and giving it one would mean putting a superuser credential in a
 * repository secret to check that credentials are well guarded. The owner runs
 * this against their own project instead, and it is the only way to answer the
 * question the tests cannot — whether the schema was ever applied.
 *
 * It matters because all four recruiter reads run in the browser under the anon
 * key, filtered by a client-supplied .eq("userEmail", …). Row level security is
 * the only thing standing between a devtools user who deletes that filter and
 * every recruiter's interviews, plus every candidate's name, email and report.
 * If RLS is off, the filter is a formality.
 */
import pg from "pg";

const CONNECTION = process.env.DATABASE_URL ?? process.argv[2];

if (!CONNECTION) {
  console.error(
    "Set DATABASE_URL (Supabase dashboard -> Project Settings -> Database -> Connection string)."
  );
  process.exit(2);
}

const TABLES = [
  "Users",
  "Interviews",
  "interview-feedback",
  "rate_limits",
  "credit_purchases",
  "interview_sessions",
  "answer_scores",
];

const SERVER_ONLY_TABLES = [
  "rate_limits",
  "credit_purchases",
  "interview_sessions",
  "answer_scores",
];

const SERVER_ONLY_FUNCTIONS = [
  "consume_rate_limit",
  "grant_purchased_credits",
  "record_answer_score",
];

const results = [];
const record = (ok, label, detail = "") => results.push({ ok, label, detail });

const pool = new pg.Pool({
  connectionString: CONNECTION,
  ssl: CONNECTION.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
});

try {
  const db = await pool.connect();

  // 1. Every table exists and has row level security switched on.
  const { rows: relRows } = await db.query(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1)`,
    [TABLES]
  );
  const byName = new Map(relRows.map((r) => [r.relname, r]));

  for (const table of TABLES) {
    const row = byName.get(table);
    if (!row) {
      record(false, `table ${table} exists`, "not found — has schema.sql been run?");
      continue;
    }
    record(row.relrowsecurity, `row level security enabled on ${table}`);
  }

  // 2. No policy may be open to the anon role, and none may be `using (true)`.
  const { rows: policies } = await db.query(
    `select tablename, policyname, cmd, roles::text[] as roles, qual, with_check
       from pg_policies where schemaname = 'public'`
  );
  record(policies.length > 0, "row level security policies are present", `${policies.length} found`);

  for (const policy of policies) {
    const roles = policy.roles ?? [];
    record(
      !roles.includes("anon") && !roles.includes("public"),
      `policy "${policy.policyname}" on ${policy.tablename} is not open to anon`,
      roles.join(", ")
    );
    if (policy.cmd === "SELECT" || policy.cmd === "ALL") {
      record(
        String(policy.qual ?? "").trim() !== "true",
        `policy "${policy.policyname}" on ${policy.tablename} is not using (true)`
      );
    }
  }

  // 3. The credit column is not writable by any browser role.
  for (const role of ["anon", "authenticated"]) {
    for (const priv of ["UPDATE", "INSERT"]) {
      const { rows } = await db.query(
        `select has_column_privilege($1, 'public."Users"', 'credits', $2) as ok`,
        [role, priv]
      );
      record(!rows[0].ok, `${role} cannot ${priv} Users.credits`);
    }
  }

  // 4. Creating an interview has to go through create_interview().
  const { rows: insertRows } = await db.query(
    `select has_table_privilege('authenticated', 'public."Interviews"', 'INSERT') as ok`
  );
  record(!insertRows[0].ok, "authenticated cannot INSERT Interviews directly");

  // 5. Server-only tables are unreachable from a browser.
  for (const table of SERVER_ONLY_TABLES) {
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query(
        `select has_table_privilege($1, format('public.%I', $2::text), 'SELECT') as ok`,
        [role, table]
      );
      record(!rows[0].ok, `${role} cannot read ${table}`);
    }
  }

  // 6. anon can read nothing at all.
  for (const table of TABLES) {
    const { rows } = await db.query(
      `select has_table_privilege('anon', format('public.%I', $1::text), 'SELECT') as ok`,
      [table]
    );
    record(!rows[0].ok, `anon cannot read ${table}`);
  }

  // 7. The functions exist, and the money ones are not callable from a browser.
  const { rows: functions } = await db.query(
    `select p.proname, p.oid::regprocedure::text as signature
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any($1)`,
    [[...SERVER_ONLY_FUNCTIONS, "create_interview"]]
  );
  const functionNames = new Set(functions.map((f) => f.proname));

  for (const name of [...SERVER_ONLY_FUNCTIONS, "create_interview"]) {
    record(functionNames.has(name), `function ${name}() exists`);
  }

  for (const fn of functions) {
    if (!SERVER_ONLY_FUNCTIONS.includes(fn.proname)) continue;
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query(
        `select has_function_privilege($1, $2, 'EXECUTE') as ok`,
        [role, fn.signature]
      );
      record(!rows[0].ok, `${role} cannot execute ${fn.proname}()`);
    }
  }

  db.release();
} catch (error) {
  console.error(`Could not check the database: ${error.message}`);
  process.exit(2);
} finally {
  await pool.end();
}

const failed = results.filter((r) => !r.ok);

for (const result of results) {
  const detail = result.detail ? `  (${result.detail})` : "";
  console.log(`${result.ok ? "  ok  " : " FAIL "} ${result.label}${detail}`);
}

console.log(
  `\n${results.length - failed.length}/${results.length} checks passed.`
);

if (failed.length > 0) {
  console.error(
    `\n${failed.length} FAILED. This database does not enforce what supabase/schema.sql describes.\n` +
      "Run supabase/schema.sql against it, and read supabase/README.md first — it revokes\n" +
      "privileges a stock Supabase project grants, so the code and the schema must match."
  );
  process.exit(1);
}

console.log("This database enforces what supabase/schema.sql describes.");
