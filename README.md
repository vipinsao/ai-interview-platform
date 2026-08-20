# AI Interview Platform

A web app where a recruiter generates a role-specific interview with a language model, shares a link, and the candidate answers out loud in the browser — each answer scored individually and collected into a report.

## Screenshots

| | |
|---|---|
| ![Homepage](./homepage.png) | ![Dashboard](./dashboard.png) |
| Landing page | Recruiter dashboard |
| ![Create interview](./createInterview.png) | ![Billing](./billing.png) |
| Interview creation | Credit purchase |

## Try it without an account

Two paths need no credentials, no card and no network.

**Run the tests.** 72 of them, in under a second, with no keys:

```bash
git clone https://github.com/vipinsao/ai-interview-platform.git
cd ai-interview-platform && npm install
npm test
```

They cover the interview state machine, the scoring arithmetic, speech
detection and fallback, model-reply validation, the credit-purchase
verification path with PayPal stubbed, share-link expiry, and startup config.
A further 19 run against a real PostgreSQL when you give them one — see
[supabase/README.md](./supabase/README.md).

**Tour the whole UI.** `.env.example` ships with working placeholder Supabase
values, so this renders the entire product straight away:

```bash
cp .env.example .env.local && npm run dev
```

Landing page, sign-in screen, dashboard shell and billing page all render on
those placeholders. The dev server prints a list of anything still missing and
starts anyway; you only need real credentials when you want to actually create
an interview. (A production server, by contrast, refuses to start — see
[Setup](#setup).)

## How it works

A signed-in recruiter fills in the role, description, duration and interview types on `/dashboard/create-interview`; `QuestionList.jsx` posts that to `app/api/ai-model/route.js` with the Supabase session JWT in an `Authorization` header, and the route verifies the token, spends one unit of that user's hourly rate limit, calls the model, and validates the reply against `questionListSchema` before returning it — a malformed reply is retried once and then refused rather than shown. The questions are stored by calling the `create_interview()` Postgres function, which spends one credit and writes the row in a single transaction under the recruiter's verified email, and the interview becomes a `/interview/<uuid>` link.

A candidate opening that link is not signed in, so `app/interview/[interview_id]/page.jsx` reads the interview through `app/api/interview/[interview_id]/route.js` instead of querying Supabase directly — row level security denies anonymous reads of the table, and the route hands back the role and the duration for the join screen, and nothing else. Entering a name posts to `app/api/interview/[interview_id]/session/route.js`, which records a session, mints the token every later request is identified by, and only then releases the questions. The session itself (`app/interview/[interview_id]/start/`) uses the browser's own Web Speech API: `speechSynthesis` reads each question aloud and `SpeechRecognition` captures the spoken answer, both wired up in `hooks/useSpeech.js`. There is no voice vendor and no key in the client.

Each answer is posted to `app/api/score-answer/route.js` as a question *index* and a transcript. The route reads the question out of the interview's stored `questionList`, scores the answer 0–10 against explicit criteria, validates the reply against `answerScoreSchema`, and **writes the score to `answer_scores` as it issues it**. When the last question is done, `app/api/ai-feedback/route.js` receives the session token and nothing else: it takes the questions from the interview and the scores from those rows, computes the rating breakdown arithmetically (`lib/score.js`), asks the model only for the prose summary, and writes the report to `interview-feedback`. Nothing the browser holds at the end decides what the report says. The recruiter reads it back on `/scheduled-interview/<id>/details`, where row level security limits them to their own interviews, and can mint a read-only `/report/<token>` link for a colleague who has no account: a UUIDv4 stored on the report row, looked up by equality on a unique index, never listed, expiring after fourteen days and revocable before then.

Every branch of the live session — no speech recognition in this browser, microphone blocked, recognition error, candidate silent, scoring endpoint down — is a transition in the pure reducer at `lib/interviewMachine.js`, which is why there is no state in which the page shows a spinner with no way forward.

```mermaid
sequenceDiagram
    actor R as Recruiter
    participant UI as Next.js app
    participant API as Route handlers
    participant LLM as Groq (OpenAI-compatible)
    participant DB as Supabase Postgres
    actor C as Candidate
    participant WS as Browser Web Speech API

    R->>UI: Create interview (role, description, duration, types)
    UI->>API: POST /api/ai-model (Bearer: Supabase JWT)
    API->>API: verify JWT, consume per-user rate limit, check credit balance
    API->>LLM: prompt for questions
    LLM-->>API: JSON reply
    API->>API: parse + validate (questionListSchema), retry once
    API-->>UI: { interviewQuestions }
    UI->>DB: create_interview() — spend 1 credit + insert, one transaction
    UI-->>R: shareable /interview/<id> link

    C->>UI: open link
    UI->>API: GET /api/interview/<id>
    API-->>UI: role + duration only
    C->>UI: enter name, join
    UI->>API: POST /api/interview/<id>/session
    API->>DB: record session (service role)
    API-->>UI: session token + questions

    loop each question
        UI->>WS: speechSynthesis.speak(question)
        WS-->>C: question read aloud
        C-->>WS: spoken answer
        WS-->>UI: SpeechRecognition transcript
        UI->>API: POST /api/score-answer (session token + question INDEX)
        API->>DB: read the question from the stored questionList
        API->>LLM: score against explicit criteria
        LLM-->>API: JSON reply
        API->>API: validate (answerScoreSchema), retry once
        API->>DB: record the score (write-once)
        API-->>UI: { score, ... }
    end

    UI->>API: POST /api/ai-feedback (session token only)
    API->>DB: read questions + recorded scores
    API->>API: aggregateScores() — arithmetic, not the model
    API->>LLM: prose summary only
    API->>DB: insert interview-feedback row (service role)
    API-->>UI: report
    UI-->>C: completion page
    R->>DB: read report (RLS: own interviews only)
```

## What the database enforces

Three things are decided in Postgres rather than in JavaScript, because in JavaScript they are not decidable:

- **Credits cannot be written by a browser.** Row level security says *whose* row you may write, not *which columns*, so the "users update own profile" policy was satisfied by `update({ credits: 999999 })` on your own row. Credits are now outside the column-level grant entirely; they move only through `create_interview()` (spend one, atomically, with the row insert) and `grant_purchased_credits()` (top up, service-role only, after the server has verified the order with PayPal).
- **Granting credits is idempotent**, on a primary key rather than an application check: the PayPal order id *is* the key of the purchase ledger, so a replayed capture loses the insert and adds nothing.
- **Rate limiting is atomic**, in one `INSERT … ON CONFLICT DO UPDATE`. It used to read, decide in JavaScript, then write, which admitted both of two simultaneous requests.
- **A candidate cannot supply their own score.** Scores are recorded by the server as it issues them, write-once per question, and the report is assembled from those rows and the interview's own question list. The single exception to write-once is a score left null because the model failed, so a retry after an outage still works.

`tests/sql.test.js` runs `supabase/schema.sql` against a real PostgreSQL and checks each of these, including under concurrency. [DECISIONS.md](./DECISIONS.md) explains why each one is shaped the way it is.

None of it helps if the schema was never applied to the database actually serving the app, and no test in this repository can tell you whether it was. Check the live one:

```bash
DATABASE_URL="postgres://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres" npm run verify:db
```

49 read-only checks against the live catalogue: row level security on every table, no policy open to `anon`, no `using (true)`, the credit column unwritable, the money and scoring functions not executable from a browser. It writes nothing. This matters because all four recruiter reads run in the browser under the anon key, filtered by a client-supplied `.eq("userEmail", …)` — with RLS off, that filter is a formality a devtools user deletes, and every recruiter's interviews plus every candidate's name, email and report are readable.

## Setup

### Prerequisites

- Node.js 20.11+ (`.nvmrc` pins 24, which is what this was built and tested on; `engines` allows 20.11+)
- A Supabase project — free tier, no card
- A Groq API key — free tier, no card
- Optionally a PayPal **sandbox** app, only if you want the billing page to work. Sandbox is free and takes no real money.

Everything the app depends on has a free tier. There is nothing to pay for.

### Install

```bash
git clone https://github.com/vipinsao/ai-interview-platform.git
cd ai-interview-platform
npm install
```

### Environment

```bash
cp .env.example .env.local
```

`.env.example` says where each value comes from, and works unedited for touring the UI.

Configuration is checked when the server process starts, by `instrumentation.js` calling `lib/server/config.js`:

- **A production server refuses to start**, listing every variable that is missing and where to get it. Deploying without a service-role key is a broken deployment and should fail at boot, not on whichever user clicks first.
- **A development server prints the same list and starts anyway**, which is what makes the placeholder tour above possible.
- **`next build` is exempt.** Compiling the bundle makes no network calls, so a build does not need anybody's secrets.

`SUPABASE_SERVICE_ROLE_KEY` is server-only. It bypasses row level security, so it must never be given a `NEXT_PUBLIC_` prefix.

Billing is optional as a group: leave all the PayPal variables blank and the purchase buttons render disabled and say why. Setting *some* of them is refused, because a client id with no secret gives the user a PayPal window and then a server that cannot verify what they paid.

### Supabase

Realistically this is 15–25 minutes and three consoles: a Supabase project, a Google Cloud OAuth client (Google is the only sign-in method — there is no email/password fallback), and a Groq key.

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run [`supabase/schema.sql`](./supabase/schema.sql). It creates five tables (`Users`, `Interviews`, `interview-feedback`, `rate_limits`, `credit_purchases`), three functions, the column-level privileges and the row level security policies.
3. Under Authentication → Providers, enable Google and paste in a client id and secret from the [Google Cloud console](https://console.cloud.google.com). Add `http://localhost:3000` and your deployed origin to the redirect allow-list.

**On `supabase/schema.sql`.** The tables were originally created through the Supabase dashboard, so the file is reconstructed from the queries the application makes rather than copied from an original migration. It does now *execute*: `tests/sql.test.js` applies this exact file to a real PostgreSQL 18 server and then checks that the privileges do what their comments claim. What that cannot tell you is whether it matches **your** project — a column that exists there but is never queried here does not appear in it. **Diff it against your project before running it**, and read [supabase/README.md](./supabase/README.md) first: applying it deliberately *revokes* privileges a stock Supabase project grants, so the code and the schema have to be deployed together.

### Run

```bash
npm run dev     # http://localhost:3000
npm test        # unit tests (node:test, no runner dependency)
npm run lint
npm run build
```

`npm run build` prerenders pages that construct the Supabase browser client, so `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be present for it to complete — the placeholders in `.env.example` are enough. No network call is made during the build.

To run the database tests too:

```bash
TEST_DATABASE_URL="postgres://…" npm test    # adds 19 tests against real Postgres
```

[supabase/README.md](./supabase/README.md) has a copy-paste way to get a throwaway PostgreSQL for free, without Docker and without root.

## Tech stack

Only what is actually in `package.json`:

- **Next.js 15.5** (App Router) and **React 18** — pages and API route handlers in one deployment
- **JavaScript**, not TypeScript — the project has a `jsconfig.json` and no `tsconfig.json`
- **Tailwind CSS v4** with Radix UI primitives (shadcn/ui "new-york" style) and **lucide-react** icons
- **Supabase** (`@supabase/supabase-js`) — Postgres, Google OAuth, row level security
- **openai** SDK pointed at **Groq**'s OpenAI-compatible endpoint
- **zod** — validation of every model reply and every API request body
- **Web Speech API** — browser built-in, no dependency
- **@paypal/react-paypal-js** — credit purchase buttons
- **sonner**, **react-hot-toast**, **moment**, **uuid**
- **ESLint 9** with `eslint-config-next`; tests run on the built-in `node:test` runner
- **pg** (dev only) — used by `tests/sql.test.js` to run `supabase/schema.sql` against a real PostgreSQL

### Dependencies

`npm audit` reports **0 vulnerabilities**, with `--omit=dev` as well. Getting there needed two things worth knowing about:

- `next` is pinned at **15.5.23**. 15.3.1 carried a critical advisory (RCE in the React flight protocol, [GHSA-9qr9-h5gf-34mp](https://github.com/advisories/GHSA-9qr9-h5gf-34mp)) plus around thirty others. 15.5.23 is a patch upgrade within the same major and clears every direct advisory.
- `package.json` has two `overrides`, for **`postcss` ^8.5.23** and **`sharp` ^0.35.0**. Both are transitive dependencies of `next`, both had high-severity advisories ([GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) and [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)), and npm's only unforced remedy for them was Next.js 16 — a major upgrade. Overriding the two packages directly clears both without one. Re-check these when upgrading Next: an override that outlives its reason is a liability.

## Notes and limitations

**Speech recognition is not available in every browser.** It works in Chrome and other Chromium browsers (Edge, Opera) and in Safari 14.1+ on macOS / 14.5+ on iOS, in all cases behind the `webkitSpeechRecognition` prefix. Firefox does not implement it at all. The app detects this at runtime and falls back to typed answers, so the interview still works everywhere — but a Firefox user types.

**Speech recognition is not private and not offline.** In Chrome, audio is streamed to Google's speech service for transcription. Nothing is recognised locally, and the feature does not work without a network connection.

**Free LLM tiers may train on what you send them.** Fine for a portfolio project; worth knowing before putting a real candidate's answers through it.

**Scoring is a language model's judgement, not a measurement.** The same answer can score differently on different runs. Only the aggregate arithmetic is deterministic — the per-answer scores are not. There is no accuracy figure for it because none has been measured.

**A rating bucket with no questions of its type shows the overall mean.** If an interview asked only technical questions, "Communication" is still given a number, and that number is the overall average rather than anything measured about communication. The report marks those figures with an asterisk and says so, but the figure is an estimate.

**Interview sessions do not survive a page refresh.** The candidate's name, session token and questions live in React context, so a refresh mid-interview ends the session; the page says so and links back rather than hanging. Answers already given are no longer lost with it — each score is written server-side as it is issued — but the interview cannot be resumed from where it stopped.

**Billing has not been exercised against a live PayPal sandbox.** The verification path is written against PayPal's documented Orders v2 API and is fully covered by tests with the PayPal client stubbed, and the OAuth request shape was confirmed against `api-m.sandbox.paypal.com` (it returns `invalid_client`, i.e. the request parsed and only the credentials were wrong). But no real sandbox order has been captured, because that needs a PayPal developer account. Do that before trusting it with anything.

**There is no server-side route guard.** `/dashboard` renders its shell before the client-side session check resolves, because the Supabase session lives in `localStorage` and Next.js middleware cannot see it. Nothing leaks — every query is scoped by row level security, so an unauthenticated visitor gets an empty shell — but the URL is not blocked. Fixing it properly means moving to `@supabase/ssr` and cookie-based sessions, which is a bigger change than it looks.

**There is no deployed instance linked here.** An earlier build was deployed to Vercel, but it runs the pre-rewrite code and its question generation is broken — the free OpenRouter model it called (`microsoft/mai-ds-r1:free`) has been retired and the endpoint now returns a 404 from upstream. Redeploy from this branch before linking a demo.

**The default model changed.** Groq retired `llama-3.3-70b-versatile` on 2026-08-16, so the previous default 404'd on a fresh clone. The default is now `openai/gpt-oss-120b`, which is on Groq's current production list and supports the JSON mode this code needs. That was checked against Groq's published model list, not by calling the API — set `LLM_MODEL` if Groq's list has moved on again.

**Two toast libraries are in use** (`sonner` and `react-hot-toast`) for historical reasons. One should go.

See [DECISIONS.md](./DECISIONS.md) for why the voice provider, the scoring format and the rate limiter are built the way they are.

## License

[MIT](./LICENSE)
