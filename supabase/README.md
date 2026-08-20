# Database

`schema.sql` is the whole database: tables, indexes, the four functions, the
table and column privileges, and the row level security policies.

## Provenance, stated honestly

The original tables were created through the Supabase dashboard, so this file is
a **reconstruction** from the queries the application makes — not an export of a
live project. What has changed since that reconstruction was written:

- It now **executes**. `tests/sql.test.js` applies this exact file to a real
  PostgreSQL 18 server on every run of the database suite, so it is no longer a
  file that has never met a database.
- It is **checked**, not just applied. The suite asserts the privileges do what
  the comments claim: that a signed-in user cannot write their own `credits`,
  that `anon` can read nothing, that the rate limiter is exact under 24-way
  concurrency, and that a replayed PayPal order grants credits once.

What is still not verified, and what you must do before deploying:

> **Diff this file against your live project before running it.** It was
> reconstructed from application queries, so a column that exists in your
> project but is never queried does not appear here. Supabase can show you the
> current definitions under Database → Tables, or `pg_dump --schema-only`
> against your project's connection string.

## This file revokes privileges. Read this before running it.

Applying it to an existing project **removes** access that project currently
grants:

| What | Before | After |
| --- | --- | --- |
| `Users.credits` | writable by the signed-in owner | not writable by any browser role |
| `Users` insert | any column | `name`, `email`, `picture` only |
| `Interviews` insert | granted to `authenticated` | revoked — use `create_interview()` |
| `interview-feedback` write | granted to `authenticated` | revoked — server only |
| `rate_limits`, `credit_purchases` | default Supabase grants | revoked from `anon` and `authenticated` |
| `interview_sessions`, `answer_scores` | did not exist | new; server-only, no client access |

The application in this repository is written against the *after* column. An
older deployment pointed at the *after* database will fail to create interviews,
because it still tries to INSERT into `Interviews` directly. Deploy the code and
the schema together.

## Running it

Paste the file into the Supabase SQL editor and run it. It is idempotent:
`create table if not exists`, `create or replace function`, `drop policy if
exists` before each `create policy`, and the one new constraint is added inside
a guard and marked `not valid` so historic rows cannot block the migration.

## Was this ever applied to the live database?

No test in this repository can answer that, and it is the question that matters
most: the four recruiter reads run in the browser under the anon key, filtered by
a client-supplied `.eq("userEmail", …)`. Row level security is the only thing
stopping a devtools user deleting that filter and reading every recruiter's
interviews and every candidate's report. If RLS is off, the filter is decoration.

```bash
DATABASE_URL="postgres://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres" npm run verify:db
```

49 read-only checks. It writes nothing, and it exits non-zero with the specific
failures if the live database does not enforce what this file describes.

To look yourself, the two queries it is built around:

```sql
-- Every one of these must report relrowsecurity = true.
select relname, relrowsecurity
  from pg_class
 where relname in ('Users','Interviews','interview-feedback','rate_limits',
                   'credit_purchases','interview_sessions','answer_scores');

-- No row here may list anon in its roles, and no SELECT policy may have
-- qual = true.
select schemaname, tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public';
```

## Running the database tests, free and without root

The suite needs any throwaway PostgreSQL. If you have none, `embedded-postgres`
downloads a real server and runs it as your own user — no Docker, no `sudo`:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"

mkdir -p /tmp/pgtest && cd /tmp/pgtest && npm init -y && npm install embedded-postgres
node -e '
import("embedded-postgres").then(async ({ default: EmbeddedPostgres }) => {
  const pg = new EmbeddedPostgres({
    databaseDir: "/tmp/pgtest/data", user: "postgres", password: "postgres",
    port: 54329, persistent: true,
  });
  await pg.initialise();
  await pg.start();
  console.log("postgres listening on 54329");
});'
```

Then, from the repository root:

```bash
TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54329/postgres" npm test
```

Without `TEST_DATABASE_URL` the suite is skipped and the rest of the tests run
normally.

**The suite drops and recreates the `public` schema.** Point it at a throwaway
database, never at your Supabase project.

### Why there is a shim

`tests/sql/supabase-shim.sql` recreates the little of Supabase that `schema.sql`
assumes exists: the `anon`, `authenticated` and `service_role` roles, an
`auth.jwt()` reading the request's JWT claims, and — importantly — Supabase's
default privilege grants. That last part is what makes the tests meaningful:
without it the tables would start closed, and a test proving `anon` cannot read
them would prove nothing. It earned its keep immediately, by catching that
`revoke ... from public` does **not** remove Supabase's explicit grant of
EXECUTE to `authenticated` — which had left the function that adds credits
callable straight from the browser.
