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
  answers always produce the same ratings, and a recruiter can trace any figure
  back to the answers behind it. Only the prose summary is generated — and if
  that call fails, the report is still returned with its ratings intact and
  flagged as having no written summary.

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

Known limitation: read-then-write is not atomic, so two simultaneous requests
can both be admitted. The fix is a Postgres function doing the increment in one
statement; at one request per spoken answer, it was not worth the complexity.

## Ownership is enforced in Postgres, not in the client

The candidate is anonymous, which originally meant the browser had to hold a
Supabase key that could read the `Interviews` table. With row level security
permitting that, the anon key can list *every* interview in the project — job
descriptions and question lists included — because RLS cannot require a client
to filter by id.

So anonymous access was removed entirely. `supabase/schema.sql` grants the
`anon` role nothing on `Interviews`, `interview-feedback` or `rate_limits`, and
the candidate's two touchpoints run server-side with the service role key:

- `app/api/interview/[interview_id]/route.js` returns exactly the one row the
  link names, and only the fields a candidate should see.
- `app/api/ai-feedback/route.js` writes the completed report, so no client needs
  write access to the feedback table and a report can only be filed against an
  interview that exists.

Recruiter reads still go straight from the browser to Supabase, which is the
intended pattern — RLS scopes them to `userEmail = auth.jwt() ->> 'email'`.
`lib/ownership.js` re-checks the owner on the returned row as defence in depth
and turns a denial into an explicit "not available" state, because the previous
behaviour was a page that loaded forever.

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
