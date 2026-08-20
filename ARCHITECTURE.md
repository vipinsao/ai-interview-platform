# Architecture

This system has three kinds of caller — a signed-in recruiter, an anonymous
candidate holding a link, and a colleague holding a report link — and three
different database keys. Almost every structural decision in the codebase is an
answer to "which of those is making this request, and what is the least it needs
to be given?"

So this document is organised by privilege rather than by folder. Every claim
cites the file and line it came from. Where a design raises a "why", it links to
[DECISIONS.md](./DECISIONS.md) rather than restating it.

---

## 1. The three callers and the three keys

```mermaid
flowchart TB
    R["Recruiter — signed in<br/>Supabase JWT in localStorage"]
    C["Candidate — no account<br/>credential is the interview link"]
    V["Report viewer — no account<br/>credential is a UUIDv4 share token"]

    subgraph App["Next.js 15 app — one deployment"]
        direction TB
        Browser["Browser bundle<br/>anon key only<br/>services/supabaseClient.js:17"]
        Routes["Route handlers — app/api/**<br/>hold LLM_API_KEY, PAYPAL_CLIENT_SECRET,<br/>SUPABASE_SERVICE_ROLE_KEY"]
    end

    PG[("Supabase Postgres<br/>RLS on all 7 tables<br/>supabase/schema.sql:497-503")]
    Groq["Groq — OpenAI-compatible<br/>api.groq.com/openai/v1<br/>lib/server/llm.js:14"]
    PP["PayPal Orders v2<br/>sandbox unless PAYPAL_ENV=live<br/>lib/server/paypal.js:15-16"]
    GA["Supabase Auth — Google OAuth"]
    WSA["Browser Web Speech API<br/>speechSynthesis + SpeechRecognition<br/>hooks/useSpeech.js"]

    R --> Browser
    C --> Browser
    V --> Browser
    Browser -->|"anon key, RLS-scoped reads"| PG
    Browser -->|"POST + Bearer JWT, or no auth"| Routes
    Browser <--> WSA
    Browser --> GA
    Routes -->|"service_role — bypasses RLS"| PG
    Routes -->|"anon key, only to verify a JWT"| GA
    Routes --> Groq
    Routes --> PP
```

There is no separate backend, no queue, no cache, no object store and no
telemetry service. An Express backend existed and was deleted (DECISIONS.md,
"The Express backend was deleted"). The candidate's voice loop runs entirely in
their own browser — there is no speech vendor and no key for one
(`hooks/useSpeech.js`, DECISIONS.md "The browser's Web Speech API…").

---

## 2. The privilege map

This is the section to read first. Five distinct privilege levels touch the
data, and the difference between them is enforced by Postgres, not by
JavaScript.

```mermaid
flowchart LR
    subgraph U["UNTRUSTED INPUT"]
        B1["request body — zod-parsed at every route"]
        B2["path params — interview_id, share token"]
        B3["Authorization header"]
        B4["PayPal order id"]
    end

    subgraph Tiers["PRIVILEGE TIERS"]
        anon["<b>anon</b> — the browser bundle<br/>RLS applies. No policy admits it<br/>to ANY table. schema.sql:524"]
        auth["<b>authenticated</b> — signed-in recruiter<br/>RLS: own rows only<br/>column grants: cannot write credits<br/>schema.sql:427-430"]
        svc["<b>service_role</b> — route handlers only<br/>bypasses RLS entirely<br/>lib/server/supabase.js:21"]
        defn["<b>security definer functions</b><br/>create_interview: authenticated<br/>the other three: service_role only<br/>schema.sql:463-481"]
    end

    B3 -->|"getUserFromRequest — asks Supabase<br/>to verify. lib/server/auth.js:19-26"| auth
    B1 --> defn
    B2 -->|"isUuidV4 before any query<br/>lib/tokens.js:9-13"| svc
    B4 -->|"regex, then PayPal is asked<br/>what the order really is<br/>billing/capture/route.js:34-39"| svc

    anon -.->|"denied by RLS"| X["no table access"]
```

**What each tier can actually do:**

| Tier | Reaches the database how | Can read | Can write |
| --- | --- | --- | --- |
| `anon` | browser, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`services/supabaseClient.js:17`) | nothing — RLS is on for all seven tables and no policy names `anon` (`supabase/schema.sql:497-503`, `523-525`) | nothing |
| `authenticated` | browser, same key + the user's JWT | own `Users` row, own `Interviews`, feedback for own interviews (`schema.sql:508-561`) | `Users.name`/`picture` only; `Interviews` update/delete only (`schema.sql:427-436`) |
| `service_role` | route handlers, `SUPABASE_SERVICE_ROLE_KEY` (`lib/server/supabase.js:21-30`) | everything — RLS is bypassed | everything |
| `create_interview()` | called by the browser as `authenticated` (`QuestionList.jsx:54`) | — | spends a credit + inserts the interview, owner taken from `auth.jwt()->>'email'`, never from an argument (`schema.sql:233`) |
| `grant_purchased_credits()`, `record_answer_score()`, `consume_rate_limit()` | `service_role` only; execute is revoked from `public, anon, authenticated` (`schema.sql:463-481`) | — | the credit balance, the score rows, the limiter |

**The one non-obvious rule in that table**, and the reason the schema comments
labour it: *row level security decides which rows, never which columns*
(`supabase/schema.sql:410-423`). The policy `users update own profile`
(`schema.sql:517-521`) is perfectly satisfied by

```js
supabase.from("Users").update({ credits: 999999 }).eq("email", myEmail)
```

because the row genuinely is the caller's. Only the column-level grant at
`schema.sql:430` — which lists `name` and `picture` and not `credits` — closes
it. And because a column-level `REVOKE` does not override a table-wide
privilege, each table grant is revoked first and re-granted per column
(`schema.sql:421-422`).

**Where untrusted input is stopped:**

- Every route body is parsed by a zod schema before anything else runs
  (`ai-model/route.js:26-31`, `score-answer/route.js:36-41`,
  `ai-feedback/route.js:43-45`, `session/route.js:28-31`,
  `feedback/share/route.js:20-23`, `billing/capture/route.js:34-39`).
- Tokens handed to people with no account are shape-checked before they become
  a query at all (`lib/tokens.js:9-13`, called at `score-answer/route.js:55`,
  `ai-feedback/route.js:66`, `lib/server/reports.js:88`).
- Identity is never read from a body. The recruiter's email comes from the
  verified JWT (`lib/server/auth.js:23-25`); the candidate's name comes from the
  session row created when they joined (`ai-feedback/route.js:148`); the
  interview's owner comes from `auth.jwt()` inside the SQL function
  (`schema.sql:233`).
- The scoring prompt takes a question **index**, not question text
  (`score-answer/route.js:38-39`), and the question is read out of the stored
  `questionList` (`score-answer/route.js:93-101`). `fillTemplate` is plain
  substitution with no escaping, so caller-supplied question text was a prompt
  injection into the project's model budget — the index is the whole of that fix
  (`score-answer/route.js:4-12`).
- Money facts come from PayPal, never from the browser. The client sends an
  order id; `captureOrder` asks PayPal what the order is, and
  `resolveGrant` decides from status, purchase-unit count, capture count,
  currency and captured amount (`lib/server/paypal.js:39-58`,
  `lib/credits.js:22-58`).

**What deliberately crosses back out:** `jsonError` returns a short message and
a real status code (`lib/server/http.js:9-11`); route handlers log the detail
with `console.error` and return a generic sentence. A shared report is returned
with `Cache-Control: private, no-store` (`report/[token]/route.js:33`) and
without any email address (`lib/server/reports.js:110-118`).

**A gap that is real and is named in the README:** there is no server-side route
guard. `/dashboard` renders its shell before the client-side session check
resolves, because the Supabase session lives in `localStorage` where Next.js
middleware cannot see it. Nothing leaks — every read is RLS-scoped — but the URL
is not blocked. The RLS layer is load-bearing for that, which is why
`scripts/verify-live-schema.mjs` exists: 49 read-only checks that the live
project actually has the policies this repository assumes.

---

## 3. One interview, end to end

Annotated with the key in use at each hop, because that is the part that is
invisible in the code.

```mermaid
sequenceDiagram
    autonumber
    actor R as Recruiter
    participant BR as Browser bundle
    participant API as app/api/**
    participant LLM as Groq
    participant DB as Postgres
    actor C as Candidate

    rect rgb(240,245,255)
    Note over R,DB: create — authenticated + service_role
    R->>BR: role, description, duration, types
    BR->>API: POST /api/ai-model, Bearer JWT<br/>QuestionList.jsx:25
    API->>API: getUserFromRequest — Supabase verifies the JWT
    API->>DB: consume_rate_limit "ai-model:userId" — service_role
    API->>DB: creditsFor(email) — service_role, read only
    API->>LLM: QUESTIONS_PROMPT
    LLM-->>API: JSON
    API->>API: parseModelJson then questionListSchema, one retry
    API-->>BR: interviewQuestions
    BR->>DB: rpc create_interview — as authenticated<br/>QuestionList.jsx:54
    Note right of DB: spends 1 credit AND inserts,<br/>one transaction, owner from auth.jwt
    end

    rect rgb(245,255,245)
    Note over C,DB: share link then join — anonymous
    C->>BR: opens /interview/uuid
    BR->>API: GET /api/interview/uuid
    API->>DB: findInterview — service_role
    API-->>BR: role and duration ONLY, no questions
    C->>BR: enters name
    BR->>API: POST /api/interview/uuid/session
    API->>DB: consume_rate_limit "interview-session:uuid"
    API->>DB: insert interview_sessions, token is the PK default
    API-->>BR: sessionToken + the question list
    end

    rect rgb(255,250,240)
    Note over C,DB: per-answer scoring — anonymous, session-scoped
    loop each question
        C->>BR: speaks or types
        BR->>API: POST /api/score-answer<br/>sessionToken + questionINDEX + transcript
        API->>API: isUuidV4 on the token, before any query
        API->>DB: consume_rate_limit "score-answer:token"
        API->>DB: findSessionWithInterview
        API->>API: question read from stored questionList, not the body
        API->>LLM: ANSWER_SCORE_PROMPT
        API->>DB: record_answer_score — write-once per question
        API-->>BR: the STORED score, which may not be the new one
    end
    end

    rect rgb(255,245,250)
    Note over C,DB: report — session token and nothing else
    BR->>API: POST /api/ai-feedback with sessionToken only
    API->>DB: listAnswerScores + the interview's questionList
    API->>API: aggregateScores — arithmetic, not the model
    API->>LLM: SUMMARY_PROMPT — prose only
    API->>DB: insert interview-feedback, mark session submitted
    API-->>BR: report
    R->>DB: reads it back under RLS, own interviews only
    end
```

The step-to-file map:

| Step | File |
| --- | --- |
| generate questions | `app/api/ai-model/route.js:36-127` |
| create the interview atomically | `app/(main)/dashboard/create-interview/_components/QuestionList.jsx:54-66` → `supabase/schema.sql:219-263` |
| join screen data | `app/api/interview/[interview_id]/route.js:20-42` |
| session mint + question release | `app/api/interview/[interview_id]/session/route.js:33-101` |
| the live session state machine | `lib/interviewMachine.js:65-167`, driven by `app/interview/[interview_id]/start/_components/InterviewSession.jsx:62-78` |
| score one answer | `app/api/score-answer/route.js:46-179` |
| record it write-once | `supabase/schema.sql:340-389` |
| build the report | `app/api/ai-feedback/route.js:58-158`, `lib/report.js:43-68`, `lib/score.js` |
| share it | `app/api/feedback/share/route.js:25-57`, `lib/server/reports.js:49-75` |
| read a shared report | `app/api/report/[token]/route.js:15-43`, `lib/server/reports.js:87-119` |

Two orderings in that flow are the load-bearing ones:

- **The questions are released by the session route, not the GET route.** They
  used to be in the join-screen payload, so anyone with a link could `curl` the
  questions and prepare against them — invisible in the UI, which only ever
  displayed the job title (`app/api/interview/[interview_id]/route.js:8-12`).
- **The score is written when it is issued, not sent back at the end.** The
  final request carries a session token and nothing else
  (`ai-feedback/route.js:43-45`), so there is no number in it that a candidate
  could have chosen. `lib/report.js:1-14` states the reasoning bluntly:
  determinism is not provenance.

---

## 4. Where the code lives

```mermaid
flowchart TB
    subgraph client["Runs in the browser"]
        pages["app/(main)/** · app/interview/** · app/report/**"]
        ctx["context/ — React context only"]
        svc["services/apiClient.js — fetch + 45s abort<br/>services/supabaseClient.js — anon client"]
    end

    subgraph server["Runs on the server only"]
        routes["app/api/** — HTTP adapters"]
        libserver["lib/server/** — every secret, every service_role call"]
    end

    subgraph shared["Pure, runs in both, imports nothing"]
        pure["lib/*.js — rateLimit · credits · plans · share<br/>tokens · report · score · aiJson · interviewMachine<br/>ownership · prompts · schemas"]
    end

    db[("supabase/schema.sql<br/>the authority")]

    pages --> svc --> routes
    pages --> svc
    routes --> libserver
    routes --> pure
    libserver --> pure
    libserver --> db
    pages -.->|"anon key, RLS-scoped"| db
    pages --> pure
    pure -.->|"must never import"| libserver
```

| Layer | Owns | May not touch |
| --- | --- | --- |
| `lib/*.js` (flat) | pure rules: rate-limit arithmetic, plan pricing, grant eligibility, token shape, report assembly, the session reducer | `process.env`, any client, any `fetch`. Every file here is unit-tested with no network and no database (`tests/*.test.js`, run by `node --test`). |
| `lib/server/*.js` | every secret and every privileged call. `serverAdminClient()` is only constructed here | HTTP concerns — none of these take a `Request` except `auth.js`, which reads one header |
| `app/api/**/route.js` | parse, authorise, rate-limit, call, map errors to status codes | business rules and SQL. The clearest example is `billing/capture/route.js`, which is an adapter over `processCreditPurchase` |
| `services/*.js` | the browser's two ways out: `fetch` with a timeout, and the anon Supabase client | secrets |
| `supabase/schema.sql` | atomicity, privilege, ownership | — |

**Enforced vs. conventional.** The layering here is enforced by *three* real
mechanisms and conventional everywhere else:

1. **The `NEXT_PUBLIC_` prefix is the actual boundary.** Next.js inlines only
   prefixed variables into the browser bundle. `SUPABASE_SERVICE_ROLE_KEY`,
   `LLM_API_KEY` and `PAYPAL_CLIENT_SECRET` have no prefix, so importing
   `lib/server/supabase.js` into a client component does not leak the key — it
   fails, because the value is `undefined` and `requireEnv` throws
   (`lib/server/env.js:10-13`).
2. **Postgres refuses.** A client component that tried to call
   `record_answer_score` gets a permission error, because execute is revoked
   from `anon` and `authenticated` (`schema.sql:478-481`). The boundary does not
   depend on anyone respecting the folder name.
3. **`lib/*.js` purity is enforced by the test runner.** These tests are plain
   `node --test` with no mocking framework and no environment; a file that
   reached for `process.env` or a network client would not run there.

What is *not* enforced: nothing stops a new route handler from doing its own
`createClient(...)` with the service-role key instead of going through
`lib/server/supabase.js`, and nothing stops a client component importing
`lib/server/reports.js` and getting a confusing runtime error instead of a
compile-time one.

---

## 5. The schema

```mermaid
erDiagram
    USERS ||--o{ INTERVIEWS : "owns, by email"
    INTERVIEWS ||--o{ INTERVIEW_SESSIONS : "cascade on delete"
    INTERVIEWS ||--o{ INTERVIEW_FEEDBACK : "cascade on delete"
    INTERVIEW_SESSIONS ||--o{ ANSWER_SCORES : "cascade on delete"
    USERS ||--o{ CREDIT_PURCHASES : "by email, not a FK"

    USERS {
        bigint id PK
        text email UK
        integer credits "default 3, check >= 0, NOT in any browser grant"
        text name "browser-writable"
        text picture "browser-writable"
    }
    INTERVIEWS {
        bigint id PK
        uuid interview_id UK "the shareable link"
        text userEmail "owner, RLS predicate, indexed"
        jsonb questionList "released only by the session route"
        text type "JSON-encoded array of type names"
    }
    INTERVIEW_SESSIONS {
        uuid session_token PK "default gen_random_uuid - the candidate credential"
        uuid interview_id FK
        text user_name
        timestamptz submitted_at "non-null means the report is filed"
    }
    ANSWER_SCORES {
        uuid session_token PK,FK "composite PK with question_index"
        integer question_index PK "composite PK with the token"
        text question "copied from questionList, never from a request"
        numeric score "null means the model failed - NOT zero"
        text transcript
    }
    INTERVIEW_FEEDBACK {
        bigint id PK
        uuid interview_id FK
        jsonb feedback "the whole report document"
        uuid share_token "unique WHERE not null"
        timestamptz share_expires_at
    }
    CREDIT_PURCHASES {
        text paypal_order_id PK "the idempotency key"
        text user_email
        integer credits_granted "check > 0"
        numeric amount_value "check > 0"
    }
    RATE_LIMITS {
        text key PK "scope:identifier"
        timestamptz window_start
        integer count "capped at limit + 1"
    }
```

(`INTERVIEW_FEEDBACK` is the real table `public."interview-feedback"`; the
hyphen is not a legal mermaid identifier.)

Five constraints in there are doing real work and are easy to mistake for
decoration:

**`credit_purchases.paypal_order_id` is the primary key.** Not a unique index on
a surrogate row, not an application-level "have we seen this?" check — the
PayPal order id *is* the key, so granting is idempotent by construction. A
replayed capture request loses the insert race and adds nothing
(`schema.sql:74-86`, `schema.sql:295-307`). An application check would be
straddled by two concurrent requests; a primary key cannot be.

**`answer_scores` has a composite primary key `(session_token, question_index)`,
and `record_answer_score` updates only `where a.score is null`**
(`schema.sql:130`, `schema.sql:375`). That is what makes a score write-once: a
candidate cannot resubmit the same answer until the model happens to return a
ten, because the second write matches no row and the function returns the score
that *is* stored (`schema.sql:378-387`, surfaced at `score-answer/route.js:167-177`).
The single exception — a null score — exists so a retry after a scoring outage
still works.

**`answer_scores.score` is nullable on purpose.** A scoring outage is recorded as
"could not be scored", never as a zero (`schema.sql:123-125`), and
`score-answer/route.js:128-145` writes the transcript unscored rather than
losing the candidate's work.

**`interview_feedback_share_token_idx` is unique *and partial***
(`schema.sql:146-150`). Unique so a token resolves to at most one report; partial
so the thousands of never-shared rows do not compete for it.

**`users_credits_non_negative` is added `NOT VALID`** (`schema.sql:397-406`) so
the file can be applied to a project whose tables already exist: the rule binds
every future write without failing on historic rows.

---

## 6. Atomicity — four decisions Postgres makes because JavaScript cannot

Each of these was a read-then-write in application code, and each was a real
bug. The pattern is the same every time: put the decision *inside* the statement.

### 6.1 The rate limiter — `INSERT … ON CONFLICT DO UPDATE … RETURNING`

`supabase/schema.sql:171-207`.

The old shape read the counter, decided in JavaScript, then wrote it back. Two
requests arriving together both read the same count and both were admitted, so a
limit of 20 passed 21 or more under exactly the load a limiter exists for. The
upsert takes a row lock, so concurrent callers are serialised by the database.

Two details worth keeping: the count is capped at `limit + 1`
(`schema.sql:197`), which keeps the stored value bounded under a sustained flood
*and* makes "allowed" decidable from the returned row alone; and
`lib/rateLimit.js:49-75` is a pure reference model of the same rule that
`tests/sql.test.js` runs side by side with the SQL over the same call sequence,
so the rule stays readable in JavaScript while Postgres remains the thing that
enforces it.

### 6.2 Spending a credit — the guard is in the `WHERE` clause

`supabase/schema.sql:219-263`.

```sql
update public."Users" set credits = credits - 1
 where email = v_email and credits > 0
returning credits into v_remaining;
if not found then raise exception 'no interview credits remaining' ...
```

Two concurrent calls cannot both see the last credit: the second matches no row.
And the insert is in the same function body, so it is the same transaction —
previously a browser-side `INSERT` followed by a separate `credits - 1` `UPDATE`
whose failure was logged and ignored, which meant a failed insert still charged
a credit and a recruiter who never sent the second request was never charged at
all (`QuestionList.jsx:47-53`).

### 6.3 Granting purchased credits — idempotent on a primary key

`supabase/schema.sql:274-326`. The ledger insert comes first and carries the key;
`v_granted` is `exists(select 1 from inserted)`, and the balance moves only when
that is true. `lib/server/credits.js:34-69` layers a cheap `findPurchase` in
front of it for the common double-click, and the comment at line 35-37 is
explicit that this is the optimisation and not the guarantee — two simultaneous
first attempts both find nothing there and are separated by the primary key.

PayPal is made idempotent separately, by sending the order id as
`PayPal-Request-Id` and by treating a `422 ORDER_ALREADY_CAPTURED` as "read the
order back" rather than as a failure (`lib/server/paypal.js:138-161`). The
comment at `paypal.js:129-131` states why both exist: the database guarantee must
not depend on a vendor.

### 6.4 Recording a score — conditional update, not read-then-write

`supabase/schema.sql:340-389`, covered in §5. `lib/server/sessions.js:70-78`
names the race it prevents: a check in JavaScript would be straddled by two
concurrent submissions of the same answer.

---

## 7. Failure modes

| Dependency / event | What actually happens | Where |
| --- | --- | --- |
| **Missing env at boot** | Production **refuses to start**. Development prints the same named list and starts anyway, so the UI can be toured with placeholder values. | `lib/server/config.js:111-121`, `instrumentation.js:14-20` |
| **Billing half-configured** | Treated as missing, not as configured: a client id with no secret gives the user a PayPal window and a server that cannot verify what they paid. All three or none. | `lib/server/config.js:39-54,65-75` |
| **Groq down or slow** | 30s timeout, `maxRetries: 1` in the client. On question generation → 502 and nothing is charged. On scoring → the transcript is written unscored and the candidate gets 502 for that answer, the interview continues. On the summary → the report is still produced with `summaryGenerated: false` and a fixed explanatory paragraph. | `lib/server/llm.js:20,43-44`; `score-answer/route.js:128-146`; `ai-feedback/route.js:50-56,116-129` |
| **Groq returns unparseable or invalid JSON** | One corrective retry with the rejection reason fed back, then `StructuredOutputError`. Never a partially-validated object. | `lib/server/llm.js:57-96`, `lib/aiJson.js:39-49` |
| **The limiter itself is unavailable** (missing service key, RPC error) | **Fails closed** — every rate-limited route returns 503 rather than running unmetered. An unmetered LLM endpoint open to the internet is the failure this exists to prevent. | `lib/server/rateLimit.js:14-18,38-41`; e.g. `ai-model/route.js:58-67` |
| **Credit balance unreadable** | 503, not "assume they have some". `canSpendCredit(null)` is false by construction. | `ai-model/route.js:83-88`, `lib/credits.js:68-70` |
| **PayPal 404 on an order** | 404 "PayPal does not recognise that payment" — which is also what a live order id looks like when `PAYPAL_ENV` is sandbox, so the environment mistake fails safe. | `billing/capture/route.js:96-98`, `lib/server/paypal.js:8-11` |
| **PayPal reachable but refuses the capture** | 502, no credits, nothing written. | `billing/capture/route.js:94-99` |
| **Replayed capture of someone else's order id** | 403 `notYours`. The replayer learns nothing and gets nothing; the credits stay with whoever the order was captured for. | `lib/server/credits.js:71-88` |
| **Supabase unreachable mid-request** | The thrown error is caught by the route's outer `try` and mapped to 500 with a generic sentence; the detail goes to `console.error`. There is no retry and no backoff anywhere. | e.g. `session/route.js:94-101` |
| **Report row missing / not yours** | Both answered identically as 404, so the endpoint cannot be used to probe which report ids exist. | `lib/server/reports.js:14-18,38` |
| **Expired share link** | 410, deliberately distinguished from 404: the holder needs to know to ask for a new one, and confirming a 122-bit token once existed is not actionable. | `report/[token]/route.js:24-29` |
| **Report submitted twice** | Answered from what was already filed — no second report row and no second model call. | `ai-feedback/route.js:105-107` |
| **Browser: any API call hangs** | 45s `AbortController`, surfaced as `ApiError(408)`. | `services/apiClient.js:4,14-46` |
| **Browser has no SpeechRecognition** (Firefox), mic denied, recognition errors, candidate silent | Each is a named transition in the reducer into a state the UI renders — typed fallback, retry, or skip. There is no "spinner with no way forward" state. | `lib/interviewMachine.js:86-107` |
| **Page refreshed mid-interview** | Session ends: name, token and questions live in React context. Scores already issued survive, because they were written server-side as they were issued; the interview cannot be resumed. | `context/InterviewDataContext.jsx`, README "Notes and limitations" |

**The failure mode that used to have no recovery path — fixed.** If PayPal
captured successfully and `grant_purchased_credits` then raised `P0002 no Users
row for %`, the whole function rolled back, ledger insert included, and the
money had been taken with nothing recorded. Every retry followed the identical
path and failed in the identical place. `grant_purchased_credits` now creates
the profile row instead of raising — same row, same default balance, that the
browser's best-effort upsert (`app/provider.jsx:54-57`) would have inserted. See
§9.2.

---

## 8. What this architecture does not do

- **It has no scheduled work of any kind.** No cron, no queue, no worker. Every
  write happens inside a request.
- **`rate_limits` is therefore cleaned up by the requests themselves.**
  `consume_rate_limit` sweeps up to 50 counters older than 24 hours on each
  call, which is what keeps the table flat without a scheduler; the unbounded
  version, `prune_rate_limits()`, is there for a backlog and is wired to
  `npm run prune:rate-limits`. See §9.1 — before this, nothing deleted from that
  table at all.
- **It cannot revoke a JWT.** Sign-out is Supabase's; a token stays valid for its
  own lifetime, and there is no server-side session store to consult.
- **In-process state that does not survive a second instance:** the PayPal OAuth
  token cache (`lib/server/paypal.js:60,96-100`) — harmless, it just re-fetches —
  and every React context. Everything that matters is in Postgres, which is what
  makes the app deployable to a serverless platform at all.
- **No server-side route guard**, for the `localStorage`-session reason in §2.
  Moving to `@supabase/ssr` and cookie sessions is the fix, and is not a small
  change.
- **The credit is spent at interview *creation*, not at question
  *generation*.** `POST /api/ai-model` checks `credits > 0`
  (`ai-model/route.js:90`) but does not decrement; the decrement happens in
  `create_interview()` when the recruiter saves. So a recruiter with one credit
  can generate up to 20 question sets in an hour — the rate limit, not the
  balance, is what bounds LLM spend on that endpoint.
- **`supabase/schema.sql` is a reconstruction, not the original migration**
  (`schema.sql:5-13`). The tables were created through the Supabase dashboard.
  There is no migration tool and no migration history; `npm run verify:db` is
  the substitute, and it only reads.
- **Scoring is a model's judgement, not a measurement**, and no accuracy figure
  has been measured. Only the aggregation is deterministic
  (`lib/score.js:1-7`).
- **A rating bucket with no questions of its type is filled with the overall
  mean** and marked with an asterisk. That number is an estimate presented next
  to measured ones.
- **Speech recognition is neither private nor offline** — in Chrome the audio is
  streamed to Google's speech service. There is no vendor contract here because
  there is no vendor here.
- **Billing has never been run against a live PayPal sandbox order.** The client
  is fully covered by tests with PayPal stubbed, and the OAuth request shape was
  confirmed against `api-m.sandbox.paypal.com`, but no real order has been
  captured.

---

## 9. Defects found while writing this document — and fixed

### 9.1 The rate limiter did not engage against a caller who varied the key — FIXED

The limiter table had a row per key and **nothing ever deleted a row** — there
was no `DELETE FROM public.rate_limits` anywhere in the repository. That would
be fine if keys were bounded. Three of them were not:

| Route | Key | Bounded by |
| --- | --- | --- |
| `POST /api/score-answer` | `score-answer:<sessionToken>` | nothing — the token was only shape-checked as a UUIDv4, and the limiter was consumed **before** the session was looked up |
| `POST /api/ai-feedback` | `ai-feedback:<sessionToken>` | same |
| `POST /api/interview/<id>/session` | `interview-session:<id>` | nothing — the path segment was not validated at all before the limiter ran |

`consume_rate_limit` is an `INSERT … ON CONFLICT`, so a key it has never seen
becomes a new row with a count of one. An anonymous caller minting a fresh
random UUID per request therefore got a permanent new row *and* a fresh
120-request budget every time: **the limiter never engaged against them**, and
the only party it restrained was the honest one, whose token is stable. That
defeats the control the credits work names as the real spend gate.

Consuming before the lookup was deliberate — the comment said it was so that an
unknown token could not buy unmetered database reads. It inverts the control.
Resolving first costs an unknown token one indexed primary-key lookup and
nothing else; consuming first cost a row and a budget.

**Fixed** in two halves.

*Ordering.* `lib/server/gate.js` holds it as one named function,
`resolveThenConsume`, which resolves the subject and only then spends the
budget, keyed on the identifier the **database** returned rather than the one
the caller sent. All three routes go through it, so they cannot drift apart
again, and the session route now validates its path segment as a UUIDv4 before
any query at all. `consume` is the only thing that writes to `rate_limits`, so
"an unknown key never reaches `consume`" is the same statement as "an unknown
key writes no row"; `tests/gate.test.js` asserts both, and asserts a known token
is still limited exactly at its limit.

*Expiry.* `consume_rate_limit` now sweeps up to 50 counters older than 24 hours
on every call — index-assisted by `rate_limits_window_start_idx` and
`for update skip locked`, so concurrent callers never queue behind each other
for the same doomed row. `p_key` is excluded from the sweep on purpose: two
data-modifying CTEs in one statement do not see each other's effects, so a
delete racing an upsert over the same key would commit the delete and lose the
count. `prune_rate_limits()` clears an accumulated backlog in one call and is
service-role only. Sweeping from the traffic that fills the table is what makes
this work in a deployment with no scheduler, which is the deployment described
in §8.

Still true, and not fixed: `rate_limits.key` is `text` with no length bound and
it is the primary key. A key longer than the btree limit (~2704 bytes) makes the
upsert raise, which becomes a 503 — an availability answer to a validation
problem. The keys are now server-issued UUIDs, so nothing reachable produces
one, but the bound is still not stated in the schema.

### 9.2 A captured payment could be unrecoverably lost — FIXED

`grant_purchased_credits` raised `P0002` when there was no `Users` row for the
email. Because the whole function is one transaction, the `credit_purchases`
insert rolled back with it — so nothing recorded that the money had been taken,
and every retry followed the identical path (`findPurchase` → null →
`captureOrder` → 422 → read back → `grantCredits` → `P0002` → 500). Money taken,
nothing recorded, permanently unrecoverable.

The `Users` row is created from the browser on first load and its failure is
logged and swallowed (`app/provider.jsx:54-57`), so "signed in but no profile
row" is a state the app can genuinely be in.

**Fixed** by creating the profile row instead of raising. The email comes from
the verified JWT; the row created is the same one, with the same default
balance, the browser's own upsert would have inserted, and that upsert fills in
name and picture the next time it runs. The `P0002` raise remains as a guard on
a state the insert above makes unreachable, and it is now safe to reach anyway:
`captureOrder` answers `ORDER_ALREADY_CAPTURED` by reading the order back, so a
retry arrives with the same facts rather than paying twice.

The existing database test asserted the defect — *"the ledger row must roll back
with the grant"* — which is how this survived a review and two security audits.
It is replaced by two cases: a payment for an email with no profile row is
recorded and credited, and a replay of it still grants nothing extra.

### 9.3 One test asserts against a role name that is not guaranteed

`tests/sql.test.js` escalated back out of `set local role authenticated` with
`set local role postgres`. The cluster superuser is not always named `postgres`
— on one that is not, PostgreSQL raises `role "postgres" does not exist` and
that assertion plus the two after it fail for a reason that has nothing to do
with the schema under test. `reset role` returns to the session's own role by
definition and needs no name.

Fixed in `98d1675`; the call is now `reset role` at `tests/sql.test.js:455`.
It is the kind of defect that only shows up when somebody else runs your
suite, which is the same reason it showed up here: reading the RLS tests to
describe the privilege map in §2 meant reading what each `set local role` was
actually asserting.
