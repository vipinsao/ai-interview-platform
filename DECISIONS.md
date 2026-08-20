# Design decisions

Why the interesting parts of this project are built the way they are, including
the trade-offs that were accepted rather than solved.

## The browser's Web Speech API instead of a paid voice SDK

The interview loop originally ran on [Vapi](https://vapi.ai), a hosted voice
agent SDK. It was replaced with the browser-native Web Speech API:
`speechSynthesis` reads each question aloud, `SpeechRecognition` captures the
answer, both wired up in `hooks/useSpeech.js`.

I replaced a paid voice SDK with the browser-native Web Speech API — zero cost,
no vendor key in the client, and anyone can clone the project and run it.

Three things improved beyond cost:

1. **No credential in the browser.** The Vapi public key was shipped to every
   visitor as `NEXT_PUBLIC_VAPI_PUBLIC_KEY`. There is now nothing to leak,
   because there is no vendor.
2. **The conversation is ours.** Previously the entire interview — the system
   prompt, the model choice, the turn taking — was configured inside a vendor
   object and executed on the vendor's infrastructure, and the app only saw
   whatever transcript came back. Now the app owns each turn, which is what
   made per-answer scoring possible at all.
3. **Smaller client.** The `/interview/[id]/start` route's first-load JavaScript
   went from 76.8 kB to 13.5 kB of route-specific code (measured from
   `next build` output before and after).

### The trade-off, stated plainly

Speech recognition is not universally supported. It works in Chromium browsers
(Chrome, Edge, Opera) and Safari 14.1+ on macOS / 14.5+ on iOS, in every case
behind the `webkitSpeechRecognition` prefix. **Firefox does not implement it.**

So support is feature-detected at runtime — `lib/speech.js` checks both
`SpeechRecognition` and `webkitSpeechRecognition` — and a browser without it
drops to typed answers instead of opening a microphone that does not exist.
That fallback is not a nicety; without it the app is broken for every Firefox
user. It is covered by tests in `tests/speech.test.js` and
`tests/interviewMachine.test.js`.

There is a second trade-off worth knowing: in Chrome, recognition is
**server-based**. Audio is streamed to Google's speech service, so it is
neither private nor available offline. A paid SDK would have the same property,
but it should be stated rather than discovered.

## Scoring is schema-constrained, and the numbers are arithmetic

The original implementation sent the whole transcript to a model at the end and
asked it for four ratings and a summary in one go, then ran `JSON.parse` on the
reply with no try/catch. Two problems: any prose around the JSON threw an
unhandled rejection and lost the interview, and the four ratings were an
unexplainable single judgement.

Now:

- Each answer is scored on its own by `app/api/score-answer/route.js` against
  four explicit criteria, and the reply must satisfy `answerScoreSchema`
  (`lib/schemas.js`) — a number in 0–10, strengths, gaps, one suggested
  improvement. A score returned as `"seven"` is rejected, not rendered as
  `NaN`.
- A rejected reply is retried **once**, with the failure reason fed back to the
  model (`completeStructured` in `lib/server/llm.js`). A second failure throws,
  and the caller degrades: the answer is stored unscored with its transcript
  intact, and the interview continues. A scoring outage must not look like a bad
  candidate, so unscored answers are excluded from the aggregate rather than
  counted as zero.
- The rating breakdown shown to the recruiter is computed in JavaScript from
  those per-answer scores (`lib/score.js`), not asked of a model. The same
  answers always produce the same ratings, and a recruiter can trace most
  figures back to the answers behind them. Only the prose summary is generated —
  and if that call fails, the report is still returned with its ratings intact
  and flagged as having no written summary.

  One caveat, because "trace any figure back" was too strong: a rating bucket
  with no questions of its type falls back to the overall mean. An interview of
  only technical questions still reports a "Communication" number, and that
  number is the overall average rather than a measurement of communication. A
  blank would be less useful than an estimate, so the fallback stays — but
  presenting an estimate as a measurement is a different thing, so
  `ratingProvenance()` in `lib/score.js` marks which buckets were measured and
  the report puts an asterisk and a footnote on the ones that were not.

Nothing a model produces reaches the database or the screen without passing a
schema first. Model replies are also never `JSON.parse`d directly:
`lib/aiJson.js` unwraps fenced blocks and returns a result object instead of
throwing.

## Rate limiting exists because the endpoints spend money

Before this, `/api/ai-model` and `/api/ai-feedback` had no authentication and no
limit of any kind. Anyone who found the URL could call them in a loop on the
project's LLM budget. That was verified against the deployed instance: an
unauthenticated POST to `/api/ai-model` was accepted and forwarded upstream.

The design:

- `/api/ai-model` is the recruiter's endpoint, so it requires a Supabase-issued
  JWT, verified server-side (`lib/server/auth.js`), and the limit is keyed on
  the verified user id.
- `/api/score-answer` and `/api/ai-feedback` are called by a candidate who has
  no account — a shareable link is their only credential. They are keyed on the
  interview id instead, and the interview must exist before any model call is
  made.
- The decision is a pure function of the stored counter and the clock
  (`evaluateRateLimit` in `lib/rateLimit.js`), which is why it can be tested
  without a database. `lib/server/rateLimit.js` only supplies persistence.
- Counters are written with the **service role key** so a user cannot clear
  their own budget with the anon key.
- If that key is missing, the route returns 503 rather than running unmetered.
  Failing open on a rate limiter would defeat its purpose.

### It is now atomic, and that mattered more than it looked

The original implementation read the counter, decided in JavaScript, then wrote
it back. Two requests arriving together both read the same count and both were
admitted. This was documented as an accepted trade-off on the grounds that the
endpoints see about one request per spoken answer — which is true of honest
traffic and irrelevant to the case a rate limiter exists for. Anyone deliberately
spending the project's LLM budget sends requests in parallel on purpose, and
against parallel requests a read-then-write limiter has roughly no effect.

The decision is now one statement inside Postgres (`consume_rate_limit()` in
`supabase/schema.sql`):

```sql
insert into rate_limits (key, window_start, count) values (…, 1)
on conflict (key) do update set count = case … least(rl.count + 1, p_limit + 1) end
returning …
```

`ON CONFLICT DO UPDATE` takes a row lock, so concurrent callers are serialised
by the database. The stored count is capped at `limit + 1`, which keeps it
bounded under a flood and — because a denial always stores `limit + 1` while the
last admitted request stores `limit` — makes "was this allowed" decidable from
the returned row alone, with no second query.

`evaluateRateLimit` in `lib/rateLimit.js` survives as the reference model of the
same rule, written as a pure function so the rule stays readable. It is not in
the request path; `tests/sql.test.js` runs it and the SQL over the same sequence
of calls and fails if they disagree. Two tests carry the argument: one re-enacts
the old read-then-write race deterministically and shows two requests admitted
against a limit of one, and one fires 24 concurrent calls at a limit of 8 and
asserts that exactly 8 are admitted.

### Atomic is not the same as engaged: the key has to be one the caller cannot choose

An exact counter is worth nothing if the caller picks which counter to
increment. All three unauthenticated routes consumed the budget *before*
resolving the identifier it was keyed on — two on a session token that was only
shape-checked as a UUIDv4, one on a path segment that was not checked at all.
`consume_rate_limit` is an upsert, so a key it has never seen becomes a new row
with a count of one: a fresh random UUID per request bought a brand new
120-request budget every time and left a permanent counter row behind. The
limiter restrained exactly one class of caller, the honest one, whose token is
stable.

The reasoning for that ordering was written down and is worth quoting, because
it sounds right: consuming first meant an unknown token could not buy unmetered
database reads. It inverts the control. Resolving first costs an unknown token
one indexed primary-key lookup — no model call, no write, no row — while
consuming first cost a row *and* a budget. The budget belongs to something that
exists.

`lib/server/gate.js` now holds the ordering as one named function,
`resolveThenConsume`, so three routes cannot drift apart again, and the counter
is keyed on the identifier the database returned rather than the one the caller
sent.

### The counters expire, swept by the traffic that creates them

There was no `DELETE` against `rate_limits` anywhere in the repository. Every
distinct key was a permanent row, and this app has no cron, no queue and no
worker — every write happens inside a request — so "add a scheduled cleanup" was
not an available answer.

`consume_rate_limit` sweeps instead: up to 50 counters older than 24 hours per
call, index-assisted and `for update skip locked`, so the table is drained by
the traffic that fills it and two concurrent callers never queue behind each
other for the same doomed row. The key being consumed is excluded from the
sweep by hand — two data-modifying CTEs in one statement do not see each other's
effects, so a delete racing an upsert over one key would commit the delete and
lose the count. `prune_rate_limits()` is the unbounded version for an existing
backlog, wired to `npm run prune:rate-limits` and callable by the service role
only.

## Billing: kept, but moved entirely to the server

The honest option was to delete the billing page. A portfolio project does not
need to take money, and a payment flow nobody has exercised against a live
sandbox is a liability. It was kept for one reason: credits are not decoration
here, they are the app's only limit on who may spend the project's LLM budget,
so "who is allowed to generate an interview" is a real access-control question
whether or not any money changes hands. Deleting the page would have removed the
button and left the question unanswered.

### What was wrong

`PayButton.onApprove` added credits from the browser:

```js
await supabase.from("Users").update({ credits: Number(user?.credits) + credits })
```

Nothing verified that PayPal had taken any money — `onApprove` fires on the
client and its argument is not proof of payment — and the amount was whichever
number the component happened to hold. Worse, the same write was reachable
without PayPal at all. Row level security permitted it: the policy checked that
the row was the caller's own, which it was. Any signed-in user could paste
`supabase.from("Users").update({ credits: 999999 }).eq("email", myEmail)` into
the console and be done.

That is verified in both directions. Against the pre-fix schema the update
succeeds and sets the balance to 999999; against the current one Postgres
refuses it with SQLSTATE 42501, and `tests/sql.test.js` asserts exactly that.

### What replaces it

- **The client sends an order id and nothing else that matters.** Identity comes
  from the verified Supabase JWT, not the request body.
- **The server captures the order with PayPal** and reads the amount from
  `purchase_units[0].payments.captures[0]` — the money actually taken, not the
  amount that was requested — then matches it against the plan table. An order
  for one cent matches no plan and buys nothing, which is why it is safe to let
  the browser create the order in the first place.
- **Granting is idempotent on a primary key.** The PayPal order id *is* the key
  of `credit_purchases`, and `grant_purchased_credits()` inserts the ledger row
  and adds the credits in one transaction. A replay loses the insert and adds
  nothing. This is deliberately not an application-level "have I seen this
  before" check, because two simultaneous replays would both pass one. Twelve
  concurrent captures of one order id are tested; exactly one grants.
- **Nothing inside that transaction may refuse a payment that already
  happened.** It used to: with no `Users` row for the buyer the function raised
  `P0002`, which rolled the ledger insert back with it. The capture had already
  been taken at PayPal, so that was money taken and nothing recorded — and
  because the ledger row died in the same aborted transaction, there was nothing
  for a retry to find. Every attempt failed in the identical place, for ever.
  The profile row is created best effort from the browser with its failure only
  logged, so this was reachable, not theoretical. The function creates the row
  now: the email comes from the verified JWT, and it is the same row with the
  same default balance the browser would have inserted. The database test that
  covered this asserted the wrong thing — *"the ledger row must roll back with
  the grant"* — which is why it survived a review and two audits.
- **Credits are outside the column grants.** No browser role can write them by
  any route, which also meant the *spending* path had to move: creating an
  interview is now `create_interview()`, one transaction that spends the credit
  and inserts the row, or does neither. That closed a second hole — the old code
  inserted the interview and then decremented in a separate request whose failure
  was logged and ignored, so a recruiter who simply never sent the second request
  was never charged.

### What is not verified

No order has been captured against a live PayPal sandbox, because that needs a
PayPal developer account. The verification path is tested end to end with the
PayPal client stubbed against recorded response shapes, and the OAuth request
shape was confirmed against `api-m.sandbox.paypal.com` — it answers
`invalid_client`, meaning the request parsed and only the credentials were
wrong. That is the honest boundary: the logic is tested, the integration is not.

`PAYPAL_ENV` is strict about this: `live` is the only value that selects the
live API and anything else falls back to sandbox. The failure modes are not
symmetrical. Accidentally running sandbox in production means real orders cannot
be captured and nobody gets credits — visible immediately. Accidentally running
live means taking real money. Only the first is reachable by a typo.

## The report is built from what the server recorded, not what the client sent

This is the one that matters most, because it defeated the product's whole
function rather than any single feature.

`/api/ai-feedback` accepted the answers in its request body — questions,
transcripts and scores — and did arithmetic over them. The interview flow is
deliberately anonymous, so there was nothing to authenticate. Anybody holding an
invite link could send:

```
POST /api/ai-feedback
{"interview_id":"<uuid from my invite link>","userName":"Alex",
 "answers":[{"question":"...","transcript":"...","score":10,"strengths":["exceptional"]}]}
```

and land a 10/10 report card, with text they wrote, on the recruiter's
dashboard. `/api/score-answer` never had to be called at all.

### Why the existing defence missed it

`lib/score.js` is documented as "deliberately arithmetic rather than a second
model call: the same set of answers must always produce the same overall
rating". That is true, and it was the wrong property to be proud of.
**Determinism was never the threat; provenance was.** Arithmetic over numbers
the candidate chose is deterministic and reliably wrong. Schema validation had
the same blind spot one level down: `answerScoreSchema` proves a score is a
number between 0 and 10, and an injected `10` satisfies it perfectly. A schema
constrains shape. It cannot constrain truthfulness.

### What replaces it

Scores are written to `answer_scores` by `/api/score-answer` at the moment it
issues them, keyed on the candidate's session. `/api/ai-feedback` is sent a
session token and nothing else; it reads the questions from the interview and
the scores from those rows. There is no field in the final request that can
change a number, because there is no field in the final request.

Write-once, with one exception: a question that already carries a real score
keeps it. Without that, an answer could be resubmitted until the model happened
to return a ten, and re-rolling would be indistinguishable from answering. The
exception is a score left null because the model failed, which may be
overwritten so a retry after an outage still works. That rule lives in
`record_answer_score()` rather than in JavaScript, because two concurrent
submissions of the same answer would straddle an application-level check —
twelve simultaneous submissions are tested, and exactly one is recorded.

### The same fix closed two more things

**The scoring endpoint was an open proxy to the language model.** It took the
question as free text and never checked it against the interview's own list, so
anyone with a link had roughly 120 completions an hour on the project's Groq key
with a prompt they controlled — and `fillTemplate` is plain string substitution
with no escaping that interpolates the question *above* the scoring criteria, so
injected text reads as instructions rather than as data. The request now carries
an integer index and the server reads the question out of the stored
`questionList`. There is no way to put words into the prompt. The same text also
used to reach the summary prompt at the end of the interview, by the same route.

**One candidate could destroy another's interview.** The rate limit was keyed on
the interview id, which every candidate holding the same invite link has, so
twenty requests from anybody 429'd the next genuine candidate to finish — and
their answers existed only in React state, so the interview they had just sat
was gone. Limits are now keyed on the session token. Starting a session is still
keyed on the interview id, which is safe because it is one cheap insert with no
model call: exhausting it delays new joins without touching an interview already
in progress, whose answers are on disk either way.

### A related leak, fixed while here

`GET /api/interview/[id]` returned the full `questionList` and `jobDescription`.
The join screen never displayed either, so this was invisible in the browser and
one curl away — anybody with a link could read the questions and prepare against
them. The questions are now released by the session route, when a candidate
actually starts.

## Shareable reports: a link is a credential, so it is a narrow one

A recruiter usually needs to show a report to a colleague who has no account.
The alternative to a link is an account for every reviewer, which nobody wants.

The link is the whole credential, so the design gives it as little to work with
as possible: a UUIDv4 (122 random bits from the platform CSPRNG), looked up by
equality on a unique partial index, never listed. There is no endpoint that
returns more than one report, so a leaked link is exactly one report and reveals
nothing about any other. It expires after fourteen days, and it can be revoked
before that. The token is validated as a UUID before any query runs, so a
malformed token never becomes a database round trip.

What a token deliberately does *not* do is authenticate anyone. Whoever holds
the link sees the assessment, which is why the public route returns the
candidate's name and the scores and withholds e-mail addresses — the private
view shows those, the shared one does not. Both views render the same component
(`components/ReportBody.jsx`), because a shared report showing different numbers
from the private one would be worse than no sharing at all.

The expired case answers 410 rather than 404. That does confirm a token once
existed, but the holder of a stale link needs to know to ask for a new one, and
confirming the existence of a 122-bit secret to somebody who already has it
tells an attacker nothing.

## Configuration is checked when the server starts

The README used to claim the app "throws on startup naming anything that is
missing". It did not. `requireEnv` was only reached when a request built a
client, so a deployment with no service-role key looked healthy and failed on
the first user who needed it, and `NEXT_PUBLIC_HOST_URL` was never checked at
all.

`instrumentation.js` now calls `assertServerEnv()` when the server process
starts. A production server refuses to start and lists everything missing; a
development server prints the same list and starts anyway. That asymmetry is
deliberate rather than lazy: it is what lets
`cp .env.example .env.local && npm run dev` render the whole product on
placeholder values, so somebody evaluating the project can look around before
opening four accounts. The build is exempt in both cases, because compiling a
bundle makes no network calls and a build that demands production credentials is
a build nobody can run.

## Ownership is enforced in Postgres, not in the client

The candidate is anonymous, which originally meant the browser had to hold a
Supabase key that could read the `Interviews` table. With row level security
permitting that, the anon key can list *every* interview in the project — job
descriptions and question lists included — because RLS cannot require a client
to filter by id.

So anonymous access was removed entirely. `supabase/schema.sql` grants the
`anon` role nothing on any table, and the candidate's touchpoints run
server-side with the service role key:

- `app/api/interview/[interview_id]/route.js` returns exactly the one row the
  link names, and only the fields a candidate should see.
- `app/api/ai-feedback/route.js` writes the completed report, so no client needs
  write access to the feedback table and a report can only be filed against an
  interview that exists.
- `app/api/report/[token]/route.js` answers a shared link, for a viewer who has
  no account at all.

Two things RLS could not do, which is why they are privileges rather than
policies. A policy decides *which rows* a role may touch, never *which columns*
— so the credit column had to be removed from the grant itself. And Supabase's
default privileges grant `EXECUTE` on new functions to `anon` and
`authenticated`, which a `revoke … from public` does **not** undo; without
naming those roles explicitly, the function that adds credits stayed callable
from the browser. That one was caught by a test, not by reading.

Recruiter reads still go straight from the browser to Supabase, which is the
intended pattern — RLS scopes them to `userEmail = auth.jwt() ->> 'email'`.
`lib/ownership.js` re-checks the owner on the returned row as defence in depth
and turns a denial into an explicit "not available" state, because the previous
behaviour was a page that loaded forever.

That re-check used to fail open. It was guarded on
`typeof owner === "string" && owner !== userEmail`, so a row with no `userEmail`
column — precisely what a query that forgot its filter returns — was not a
string, therefore not a mismatch, therefore allowed. The helper exists to catch
that one case and did not. The guard is gone and both cases are tested.

Because these reads happen in the browser, RLS is not defence in depth for them;
it is the defence. `npm run verify:db` exists to answer the only question the
test suite cannot — whether the schema was ever applied to the database actually
serving the app. It is read-only, and it is deliberately not a CI job: CI has no
route to production, and giving it one would mean storing a superuser credential
in a repository secret in order to check that credentials are well guarded.

## Groq as the language model provider

Groq's developer tier is free with no card and no credit balance — it is gated
by rate limits rather than billed — and its latency is low, which matters in a
voice loop where a candidate is waiting between questions. It exposes an
OpenAI-compatible API, so the official `openai` client works against it
unchanged and `LLM_BASE_URL` / `LLM_MODEL` can point the same code at any other
OpenAI-compatible provider.

Only one provider is implemented. Supporting Groq and Gemini behind a provider
interface would be a reasonable design, but two providers half-tested is worse
than one that works, so the seam is an environment variable rather than an
abstraction.

Model ids go stale, and this project has already been bitten: Groq retired
`llama-3.3-70b-versatile` on 2026-08-16 and the default was left pointing at it,
so a fresh clone got a 404 on its first question. The default is now
`openai/gpt-oss-120b` — on Groq's current production list, and one of the models
that supports the JSON mode this code depends on. That was checked against
Groq's published list rather than by calling the API, since no key was available
here, and `LLM_MODEL` overrides it when the list moves again.

Current Groq rate limits are published at
<https://console.groq.com/docs/rate-limits>; no figure is quoted here because a
number copied into a README goes stale silently.

Free tiers generally reserve the right to train on submitted data. That is
acceptable for a portfolio project and would not be for real candidate answers.

## The Express backend was deleted

`backend/` held an Express server duplicating the two API routes, with its own
copy of the prompts, no authentication and no rate limiting. Nothing called it —
the frontend posts to relative `/api/...` paths handled by Next.js — and a
second unauthenticated copy of the money-spending endpoints is a liability, not
a feature. It is in the git history if it is ever wanted back.
