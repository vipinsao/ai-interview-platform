/**
 * Clears expired rate limit counters.
 *
 * The table had no expiry of any kind: every distinct key was a permanent row,
 * and the keys derive from session tokens and interview ids, so it grew for the
 * life of the deployment. consume_rate_limit now sweeps a bounded batch on
 * every call, which keeps it flat from here on and needs no scheduler. This
 * script is for the backlog that has already accumulated, and for anyone who
 * would rather schedule the cleanup than let request traffic do it.
 *
 *   npm run prune:rate-limits              # counters older than 24 hours
 *   RETAIN_HOURS=1 npm run prune:rate-limits
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment, the same two the server itself uses.
 */
import { pruneRateLimits } from "../lib/server/rateLimit.js";

const hours = Number(process.env.RETAIN_HOURS ?? 24);
if (!Number.isFinite(hours) || hours <= 0) {
  console.error("RETAIN_HOURS must be a positive number of hours.");
  process.exit(2);
}

try {
  const removed = await pruneRateLimits({ retainMs: hours * 60 * 60 * 1000 });
  console.log(`removed ${removed} rate limit counter(s) older than ${hours}h`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
