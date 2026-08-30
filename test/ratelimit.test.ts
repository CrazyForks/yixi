import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { LIMITS, checkRate, pruneRateLimits, subjectOf } from '../src/ratelimit'
import type { Env } from '../src/types'

const testEnv: Env = { DB: env.DB, COOKIE_SECRET: env.COOKIE_SECRET, TOKEN_KEY: env.TOKEN_KEY }

function from(ip: string): Request {
  return new Request('https://yixi.example.workers.dev/login', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
  })
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rate_limit').run()
})

describe('rate limiting', () => {
  it('allows exactly the configured number of attempts, then refuses', async () => {
    const req = from('203.0.113.10')
    const max = LIMITS.login!.max

    for (let i = 0; i < max; i++) {
      const r = await checkRate(testEnv, 'login', req)
      expect(r.allowed, `attempt ${i + 1} of ${max} should be allowed`).toBe(true)
    }

    const over = await checkRate(testEnv, 'login', req)
    expect(over.allowed).toBe(false)
    expect(over.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('counts each address separately', async () => {
    const max = LIMITS.login!.max
    for (let i = 0; i < max; i++) await checkRate(testEnv, 'login', from('203.0.113.11'))

    // One address exhausting its allowance must not lock out the rest of the
    // internet — a shared bucket would turn one abuser into an outage.
    expect((await checkRate(testEnv, 'login', from('203.0.113.11'))).allowed).toBe(false)
    expect((await checkRate(testEnv, 'login', from('203.0.113.12'))).allowed).toBe(true)
  })

  it('lets the window lapse and starts over', async () => {
    const req = from('203.0.113.13')
    const t0 = 1_800_000_000_000
    const max = LIMITS.login!.max
    for (let i = 0; i < max; i++) await checkRate(testEnv, 'login', req, t0)
    expect((await checkRate(testEnv, 'login', req, t0)).allowed).toBe(false)

    const later = t0 + LIMITS.login!.windowMs + 1
    expect((await checkRate(testEnv, 'login', req, later)).allowed).toBe(true)
  })

  it('keeps buckets independent, so failed logins do not block signing up', async () => {
    const req = from('203.0.113.14')
    for (let i = 0; i < LIMITS.login!.max; i++) await checkRate(testEnv, 'login', req)

    expect((await checkRate(testEnv, 'login', req)).allowed).toBe(false)
    expect((await checkRate(testEnv, 'register', req)).allowed).toBe(true)
  })

  it('does not throttle a bucket it has no limit for', async () => {
    const req = from('203.0.113.15')
    for (let i = 0; i < 50; i++) {
      expect((await checkRate(testEnv, 'nonexistent', req)).allowed).toBe(true)
    }
  })

  it('falls open when the store is unreachable', async () => {
    // A broken throttle must never become an outage: registration abuse is
    // recoverable, locking every user out of sign-in is not.
    const broken = {
      ...testEnv,
      DB: {
        prepare() {
          throw new Error('D1 is down')
        },
      } as unknown as D1Database,
    }
    expect((await checkRate(broken, 'login', from('203.0.113.16'))).allowed).toBe(true)
  })

  it('buckets requests with no client IP together rather than exempting them', async () => {
    const bare = new Request('https://yixi.example.workers.dev/login', { method: 'POST' })
    expect(subjectOf(bare)).toBe('unknown')

    for (let i = 0; i < LIMITS.login!.max; i++) await checkRate(testEnv, 'login', bare)
    // Exempting header-less requests would hand an attacker an unlimited lane
    // simply by stripping a header.
    expect((await checkRate(testEnv, 'login', bare)).allowed).toBe(false)
  })

  it('holds the line when the whole burst arrives at once', async () => {
    // The serial tests above all passed against a read-then-increment limiter
    // that a review proved was completely bypassable: thirty concurrent callers
    // each read a count below the limit before any increment landed, and all
    // thirty were let through. Sequential assertions cannot see that, so this
    // one fires the burst.
    const req = from('203.0.113.99')
    const max = LIMITS.login!.max
    const burst = max * 3

    const results = await Promise.all(
      Array.from({ length: burst }, () => checkRate(testEnv, 'login', req)),
    )
    const allowed = results.filter((r) => r.allowed).length

    expect(allowed).toBe(max)
    expect(results.filter((r) => !r.allowed)).toHaveLength(burst - max)
  })

  it('keeps refusing once over the line, without extending the window', async () => {
    const req = from('203.0.113.98')
    const t0 = 1_800_000_000_000
    const max = LIMITS.login!.max
    for (let i = 0; i < max; i++) await checkRate(testEnv, 'login', req, t0)

    // Hammering during a lockout must not push the reset further out, or an
    // attacker could keep a legitimate user locked out indefinitely.
    const mid = t0 + LIMITS.login!.windowMs / 2
    for (let i = 0; i < 20; i++) await checkRate(testEnv, 'login', req, mid)

    const justAfter = t0 + LIMITS.login!.windowMs + 1
    expect((await checkRate(testEnv, 'login', req, justAfter)).allowed).toBe(true)
  })

  it('prunes only windows that have already closed', async () => {
    const now = 1_800_000_000_000
    await checkRate(testEnv, 'login', from('203.0.113.17'), now - 5_000)
    await checkRate(testEnv, 'login', from('203.0.113.18'), now - 90_000_000)

    const dropped = await pruneRateLimits(testEnv, now - 3_600_000)
    expect(dropped).toBe(1)

    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_limit').first<{ n: number }>()
    expect(left?.n).toBe(1)
  })
})
