import type { Env } from './types'

/**
 * Per-IP throttling for the endpoints anyone can reach.
 *
 * Deliberately coarse. The threat is a script hammering /login to guess a
 * password, or minting accounts in a loop until D1 is full — both of which show
 * up as an obviously abnormal rate from one address. A human who fat-fingers
 * their password five times in a row should never notice this exists.
 */
export interface Limit {
  /** Requests allowed per window. */
  max: number
  /** Window length in ms. */
  windowMs: number
}

export const LIMITS: Record<string, Limit> = {
  // Sign-up is a once-ever action; anything past a handful an hour is a script.
  register: { max: 5, windowMs: 60 * 60 * 1000 },
  claim: { max: 5, windowMs: 60 * 60 * 1000 },
  // Reset needs a valid 128-bit token to do anything, so the limit here is
  // about CPU burn rather than guessing.
  recover: { max: 10, windowMs: 60 * 60 * 1000 },
  // Typos are normal; sustained attempts are not.
  login: { max: 12, windowMs: 10 * 60 * 1000 },
}

/**
 * The edge sets CF-Connecting-IP and a client cannot forge it. Falling back to
 * a shared bucket when it is absent (local dev, odd proxies) fails closed for
 * the group rather than handing everyone an unlimited allowance each.
 */
export function subjectOf(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

/**
 * Counts this request and reports whether it is over the line. Returns
 * `allowed: false` only when the caller has already used the whole window.
 *
 * Fails open on a D1 error: a throttle that breaks should not take sign-in down
 * with it. Registration abuse is recoverable; locking every user out is not.
 */
export async function checkRate(
  env: Env,
  bucket: keyof typeof LIMITS | string,
  request: Request,
  now = Date.now(),
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const limit = LIMITS[bucket]
  if (!limit) return { allowed: true, retryAfterSeconds: 0 }
  const subject = subjectOf(request)
  const cutoff = now - limit.windowMs

  try {
    // One statement, deliberately. Reading the count and then incrementing it
    // is a check-then-act race, and under concurrency it does not merely leak a
    // little — thirty simultaneous requests all read a count below the limit and
    // all pass, which is the whole limiter gone. Since PBKDF2 is capped at 100k
    // rounds precisely because this is meant to be the outer defense, that hands
    // an attacker unlimited-concurrency password guessing.
    //
    // The upsert both resets a lapsed window and increments a live one, and
    // RETURNING hands back the resulting state, so the decision is made from a
    // value that cannot have changed under us. Requests past the limit still
    // increment; they just do not extend `window_start`, so the window still
    // closes on schedule.
    const row = await env.DB.prepare(
      `INSERT INTO rate_limit (bucket, subject, window_start, count)
       VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (bucket, subject) DO UPDATE SET
         window_start = CASE WHEN rate_limit.window_start <= ?4 THEN ?3 ELSE rate_limit.window_start END,
         count        = CASE WHEN rate_limit.window_start <= ?4 THEN 1  ELSE rate_limit.count + 1 END
       RETURNING count, window_start`,
    )
      .bind(bucket, subject, now, cutoff)
      .first<{ count: number; window_start: number }>()

    if (!row) return { allowed: true, retryAfterSeconds: 0 }
    if (row.count <= limit.max) return { allowed: true, retryAfterSeconds: 0 }

    const waitMs = limit.windowMs - (now - row.window_start)
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) }
  } catch (err) {
    // A broken throttle must not become an outage: registration abuse is
    // recoverable, locking every user out of sign-in is not.
    console.error('rate limit check failed, allowing', err)
    return { allowed: true, retryAfterSeconds: 0 }
  }
}

/** Drops windows that closed long ago; called from the nightly cron. */
export async function pruneRateLimits(env: Env, olderThan: number): Promise<number> {
  const res = await env.DB.prepare('DELETE FROM rate_limit WHERE window_start < ?1')
    .bind(olderThan)
    .run()
  return res.meta.changes ?? 0
}
