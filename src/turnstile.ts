import type { Env } from './types'

/**
 * Cloudflare Turnstile, on /register and nowhere else.
 *
 * WHY THIS EXISTS. This repository is public, so the deployment URL is public,
 * and /register is reachable by anyone who reads the README. Until now the only
 * thing between a loop script and a D1 full of junk accounts was the per-IP
 * throttle in src/ratelimit.ts — 5 registrations an hour from one address, which
 * a script distributed over a few hundred addresses walks straight through.
 * Turnstile sits *on top of* that throttle, not instead of it: the throttle
 * still bounds one address, and the challenge makes each attempt cost a solve.
 *
 * WHY ONLY /register. The other three open routes were considered and left
 * alone, deliberately:
 *   /login   — a challenge there punishes the person who mistyped their own
 *              password, which is the common case, and buys little: the
 *              12/10min throttle already makes guessing hopeless.
 *   /claim   — needs a 128-bit token in hand. Unguessable, so there is nothing
 *              for a challenge to slow down.
 *   /recover — same token, same argument.
 * A challenge on any of those three is friction charged to real users for no
 * security. See SECURITY.md.
 *
 * FAIL-OPEN, ON PURPOSE. Two of the three ways this can go wrong let the
 * registration through rather than blocking it:
 *
 *   1. Not configured. No keys, no widget, no verification — registration works
 *      exactly as it did before this file existed. That is what makes `npm run
 *      dev` and a self-hoster's first deploy work without a Cloudflare account.
 *   2. Configured, but Cloudflare cannot answer. A siteverify call that throws,
 *      times out, returns unparseable JSON, or reports a problem with *our*
 *      secret is treated as "no answer" and the registration proceeds.
 *
 * The cost is stated plainly because it is real: in case 1 there is no bot
 * protection at all, and in case 2 there is none for as long as the outage
 * lasts. This matches the rule the Shortcut side of this product already lives
 * by (see SECURITY.md, "Fail-open is deliberate") — locking somebody out of
 * their own tool is worse than failing to stop one signup.
 *
 * The third way — the client did not present a solvable token — is NOT fail-open.
 * A missing or rejected token is indistinguishable from a bot, and it is the
 * only thing this check actually catches; letting it through would make the
 * whole feature theatre. The residual risk is a browser that can reach this app
 * but not challenges.cloudflare.com, which cannot register while that is true.
 * The escape hatch for an operator watching that happen is to delete the secret,
 * which returns the whole system to case 1.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** The hidden input the widget injects into the enclosing form. */
export const TURNSTILE_FIELD = 'cf-turnstile-response'

/**
 * Tokens are a few hundred bytes. The cap is not validation — it is a refusal
 * to forward a megabyte of somebody's choosing to a third party on our own
 * outbound connection.
 */
const MAX_TOKEN_LENGTH = 4096

/** How long to wait for Cloudflare before treating the answer as absent. */
const SITEVERIFY_TIMEOUT_MS = 5000

export interface TurnstileKeys {
  /** Public. Rendered into the page. */
  siteKey: string
  /** Never leaves the server. */
  secret: string
}

/**
 * Both keys or neither. A half-configured deployment is a lockout waiting to
 * happen in whichever direction it is half: a site key with no secret renders a
 * widget nothing verifies, and a secret with no site key means no widget renders
 * and therefore every submission arrives tokenless and is rejected forever. So
 * one missing value disables the feature entirely and says so in the log, rather
 * than half-enabling it.
 */
export function turnstileKeys(env: Env): TurnstileKeys | null {
  const siteKey = (env.TURNSTILE_SITE_KEY ?? '').trim()
  const secret = (env.TURNSTILE_SECRET ?? '').trim()
  if (!siteKey || !secret) {
    if (siteKey || secret) {
      console.warn(
        'turnstile: only one of TURNSTILE_SITE_KEY / TURNSTILE_SECRET is set; disabling the challenge',
      )
    }
    return null
  }
  return { siteKey, secret }
}

/**
 * Deliberately asymmetric. `allow: true` carries a reason because the log and
 * the tests want to know which of the fail-open paths was taken; `allow: false`
 * carries nothing at all, so a caller *cannot* word the rejections apart even by
 * accident. src/account.ts collapses three login failures into one error code by
 * discipline; this type does the same job structurally.
 */
export type TurnstileOutcome =
  | { allow: true; why: 'not_configured' | 'verified' | 'no_answer' }
  | { allow: false }

interface SiteverifyResponse {
  success?: unknown
  'error-codes'?: unknown
}

/**
 * Error codes that mean "the problem is on our side of the wire". A client
 * cannot induce any of these: the secret comes from the environment and nowhere
 * else, and `internal-error` is Cloudflare telling us to retry. These fail open.
 *
 * Everything else fails closed, including codes not on either list. The
 * dangerous direction for an unknown code is the permissive one — `bad-request`
 * in particular is reachable with a token of the caller's choosing, so treating
 * it as "no answer" would hand a bot a bypass by sending deliberate garbage.
 */
const OUR_FAULT_CODES = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error'])

/**
 * @param keys pass the result of `turnstileKeys(env)` so the caller can reuse it
 *   for rendering the widget without reading the environment twice.
 */
export async function verifyTurnstile(
  keys: TurnstileKeys | null,
  token: string,
): Promise<TurnstileOutcome> {
  if (!keys) return { allow: true, why: 'not_configured' }
  if (!token || token.length > MAX_TOKEN_LENGTH) return { allow: false }

  let body: SiteverifyResponse
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      // `remoteip` is deliberately not sent. It is optional, and on a phone the
      // address can legitimately change between loading the form and submitting
      // it (cellular hand-off, CGNAT), which would turn a real signup into a
      // rejection for a reason nobody could diagnose.
      body: new URLSearchParams({ secret: keys.secret, response: token }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    })
    // A non-2xx from siteverify is Cloudflare failing to answer, not a verdict.
    if (!res.ok) {
      console.warn(`turnstile: siteverify returned ${res.status}, allowing`)
      return { allow: true, why: 'no_answer' }
    }
    body = (await res.json()) as SiteverifyResponse
  } catch (err) {
    // Thrown, timed out, or unparseable. Same conclusion: no answer.
    console.warn('turnstile: siteverify unreachable, allowing', err)
    return { allow: true, why: 'no_answer' }
  }

  if (body.success === true) return { allow: true, why: 'verified' }

  const codes = Array.isArray(body['error-codes'])
    ? body['error-codes'].filter((c): c is string => typeof c === 'string')
    : []
  if (codes.length > 0 && codes.every((code) => OUR_FAULT_CODES.has(code))) {
    console.warn(`turnstile: misconfigured (${codes.join(', ')}), allowing`)
    return { allow: true, why: 'no_answer' }
  }

  return { allow: false }
}
