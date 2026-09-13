// Turnstile on /register.
//
// The properties worth pinning here are all about the two directions this can
// fail, because they are not symmetric and the asymmetry is the whole design:
//
//   1. FAIL OPEN when the problem is ours. No keys configured, or configured
//      and Cloudflare cannot answer — sign-up must still work. A captcha that
//      breaks must not become "nobody can have an account", which is the same
//      rule the Shortcut side of this product lives by.
//   2. FAIL CLOSED when the client did not present a solvable token. That is
//      the only thing the check actually catches; letting it through would make
//      the feature theatre. And a rejected registration must leave no user row.
//   3. One message for every rejection, exactly as /login collapses three
//      login failures into one.
//   4. The external origin appears on /register and nowhere else — one host,
//      and only while a widget is configured. Everything else in this product
//      keeps `default-src 'none'` with no exceptions.

import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { handleClaim, handleLogin, handleRecover, handleRegister } from '../src/ui/account'
import { verifyTurnstile } from '../src/turnstile'

const BASE = 'https://yixi.example.workers.dev'
const SITE_KEY = '1x00000000000000000000AA'
const SECRET = '1x0000000000000000000000000000000AA'
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const PASSWORD = 'correct-horse-battery'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions_web'),
    env.DB.prepare('DELETE FROM rate_limit'),
    env.DB.prepare('DELETE FROM user_apps'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

beforeEach(async () => {
  await reset()
  // Every test states its own configuration. The suite-wide default is "off",
  // which is also what the other fifteen test files rely on.
  env.TURNSTILE_SITE_KEY = ''
  env.TURNSTILE_SECRET = ''
})

afterEach(() => {
  // `singleWorker: true` means one shared env for the whole run, so a leaked
  // key here would silently start demanding a challenge in every other file.
  env.TURNSTILE_SITE_KEY = ''
  env.TURNSTILE_SECRET = ''
  vi.unstubAllGlobals()
})

function configure(): void {
  env.TURNSTILE_SITE_KEY = SITE_KEY
  env.TURNSTILE_SECRET = SECRET
}

/** Stands in for challenges.cloudflare.com. Returns the recorded request bodies. */
function stubSiteverify(reply: () => Promise<Response> | Response): string[] {
  const seen: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(SITEVERIFY)) throw new Error(`unexpected outbound fetch: ${url}`)
    seen.push(String(init?.body ?? ''))
    return await reply()
  })
  return seen
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function signupFields(extra: Record<string, string> = {}): Record<string, string> {
  return {
    email: 'someone@example.com',
    password: PASSWORD,
    password2: PASSWORD,
    name: '某人',
    ...extra,
  }
}

function post(path: string, fields: Record<string, string>): Request {
  return new Request(`${BASE}${path}`, { method: 'POST', body: new URLSearchParams(fields) })
}

async function userCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
  return row?.n ?? 0
}

// --- 1. fail open when the problem is on our side ---------------------------

describe('nothing configured', () => {
  it('registers exactly as it did before Turnstile existed', async () => {
    // The whole point of the fail-open design: `npm run dev` and a self-hoster's
    // first deploy have no Cloudflare widget, and sign-up has to work anyway.
    const res = await handleRegister(post('/register', signupFields()), env)

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/account?new=1')
    expect(await userCount()).toBe(1)
  })

  it('renders no widget and reaches no external host', async () => {
    const res = await handleRegister(new Request(`${BASE}/register`), env)
    const html = await res.text()

    expect(html).not.toContain('challenges.cloudflare.com')
    expect(html).not.toContain('cf-turnstile')
    expect(res.headers.get('content-security-policy')).not.toContain('challenges.cloudflare.com')
  })

  it('never calls siteverify at all', async () => {
    const seen = stubSiteverify(() => ok({ success: true }))
    await handleRegister(post('/register', signupFields()), env)
    expect(seen).toEqual([])
  })
})

describe('half configured', () => {
  // A site key with no secret renders a widget nothing verifies; a secret with
  // no site key renders no widget, so every submission arrives tokenless and is
  // rejected forever. Both are lockouts, so one missing value disables the lot.
  it('falls back to no challenge when only the site key is set', async () => {
    env.TURNSTILE_SITE_KEY = SITE_KEY
    const res = await handleRegister(post('/register', signupFields()), env)

    expect(res.status).toBe(303)
    expect(await userCount()).toBe(1)
  })

  it('falls back to no challenge when only the secret is set', async () => {
    env.TURNSTILE_SECRET = SECRET
    const res = await handleRegister(post('/register', signupFields()), env)

    expect(res.status).toBe(303)
    expect(await userCount()).toBe(1)
  })

  it('renders no widget when the secret is missing', async () => {
    env.TURNSTILE_SITE_KEY = SITE_KEY
    const html = await (await handleRegister(new Request(`${BASE}/register`), env)).text()
    expect(html).not.toContain('cf-turnstile')
  })
})

describe('Turnstile unreachable', () => {
  it('lets the registration through when the fetch throws', async () => {
    configure()
    stubSiteverify(() => {
      throw new Error('getaddrinfo ENOTFOUND')
    })

    const res = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)

    expect(res.status).toBe(303)
    expect(await userCount()).toBe(1)
  })

  it('lets the registration through on a 5xx from siteverify', async () => {
    configure()
    stubSiteverify(() => new Response('bad gateway', { status: 502 }))

    const res = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)

    expect(res.status).toBe(303)
    expect(await userCount()).toBe(1)
  })

  it('lets the registration through when the answer is not JSON', async () => {
    configure()
    stubSiteverify(() => new Response('<html>maintenance</html>', { status: 200 }))

    const res = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)

    expect(res.status).toBe(303)
    expect(await userCount()).toBe(1)
  })

  it('treats internal-error as no answer, not as a verdict', async () => {
    configure()
    stubSiteverify(() => ok({ success: false, 'error-codes': ['internal-error'] }))

    const res = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)

    expect(res.status).toBe(303)
    expect(await userCount()).toBe(1)
  })

  it('treats a broken secret as our problem, not the visitor’s', async () => {
    // A typo'd TURNSTILE_SECRET would otherwise reject every registration
    // forever, with the error visible only to whoever reads the logs. No client
    // can induce this code, so failing open on it is safe.
    configure()
    stubSiteverify(() => ok({ success: false, 'error-codes': ['invalid-input-secret'] }))

    const res = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)

    expect(res.status).toBe(303)
    expect(await userCount()).toBe(1)
  })
})

// --- 2. fail closed on a token the client could not produce ------------------

describe('a rejected challenge', () => {
  it('refuses an invalid token and creates no user', async () => {
    configure()
    stubSiteverify(() => ok({ success: false, 'error-codes': ['invalid-input-response'] }))

    const res = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': 'forged' })), env)
    const html = await res.text()

    expect(res.status).toBe(400)
    expect(html).toContain('人机验证没过')
    expect(await userCount()).toBe(0)
  })

  it('refuses a submission with no token, without asking Cloudflare', async () => {
    configure()
    const seen = stubSiteverify(() => ok({ success: true }))

    const res = await handleRegister(post('/register', signupFields()), env)

    expect(res.status).toBe(400)
    expect(await userCount()).toBe(0)
    // No point spending a round-trip to be told `missing-input-response`.
    expect(seen).toEqual([])
  })

  it('refuses a replayed token', async () => {
    configure()
    stubSiteverify(() => ok({ success: false, 'error-codes': ['timeout-or-duplicate'] }))

    const res = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)

    expect(res.status).toBe(400)
    expect(await userCount()).toBe(0)
  })

  it('refuses on bad-request rather than reading it as an outage', async () => {
    // Reachable with a token of the caller's choosing, so treating it as "no
    // answer" would hand a bot a bypass: send deliberate garbage, get waved in.
    configure()
    const seen = stubSiteverify(() => ok({ success: false, 'error-codes': ['bad-request'] }))

    const res = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)

    expect(res.status).toBe(400)
    expect(await userCount()).toBe(0)
    // The verdict came back from a real round trip, not from the local
    // short-circuit on an empty token, which is what this test is about.
    expect(seen).toHaveLength(1)
  })

  it('refuses on an error code nobody has heard of', async () => {
    // Unknown codes fail closed: the permissive direction is the dangerous one.
    configure()
    stubSiteverify(() => ok({ success: false, 'error-codes': ['some-future-code'] }))

    expect((await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)).status).toBe(400)
    expect(await userCount()).toBe(0)
  })

  it('refuses a failure that carries no codes at all', async () => {
    configure()
    stubSiteverify(() => ok({ success: false }))

    expect((await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)).status).toBe(400)
    expect(await userCount()).toBe(0)
  })

  it('refuses an absurdly long token without forwarding it to Cloudflare', async () => {
    configure()
    const seen = stubSiteverify(() => ok({ success: true }))

    const res = await handleRegister(
      post('/register', signupFields({ 'cf-turnstile-response': 'x'.repeat(50_000) })),
      env,
    )

    expect(res.status).toBe(400)
    expect(seen).toEqual([])
  })
})

// --- 3. the successful path, and what it says to Cloudflare -----------------

describe('a solved challenge', () => {
  it('registers, and hands the secret and the token to siteverify', async () => {
    configure()
    const seen = stubSiteverify(() => ok({ success: true }))

    const res = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/account?new=1')
    expect(res.headers.get('set-cookie')).toBeTruthy()
    expect(await userCount()).toBe(1)

    expect(seen).toHaveLength(1)
    const sent = new URLSearchParams(seen[0])
    expect(sent.get('secret')).toBe(SECRET)
    expect(sent.get('response')).toBe(TOKEN)
    // The visitor's address is deliberately not sent: on a phone it can change
    // between loading the form and submitting it.
    expect(sent.has('remoteip')).toBe(false)
  })

  it('checks the challenge before spending PBKDF2 on the password', async () => {
    // Ordering matters twice over: it keeps a script from burning our CPU, and
    // it puts the challenge in front of the one thing this page discloses —
    // whether an address is already registered.
    configure()
    stubSiteverify(() => ok({ success: false, 'error-codes': ['invalid-input-response'] }))

    const first = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)
    expect(first.status).toBe(400)

    // Same address, this time with a solved challenge: it must still be free,
    // i.e. the rejected attempt never got as far as creating anything.
    vi.unstubAllGlobals()
    stubSiteverify(() => ok({ success: true }))
    const second = await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)
    expect(second.status).toBe(303)
  })

  it('does not let a mistyped password confirmation reach Cloudflare twice', async () => {
    configure()
    const seen = stubSiteverify(() => ok({ success: true }))

    const res = await handleRegister(
      post('/register', signupFields({ password2: 'something-else', 'cf-turnstile-response': TOKEN })),
      env,
    )

    expect(res.status).toBe(400)
    // One round trip, not two: the challenge is checked once, before the two
    // password boxes are compared. And the re-rendered form carries a fresh
    // widget, or the retry would be impossible.
    expect(seen).toHaveLength(1)
    expect(await res.text()).toContain('cf-turnstile')
  })
})

// --- 4. what the failure page is allowed to say -----------------------------

describe('what a rejection discloses', () => {
  const reasons: Array<[string, unknown]> = [
    ['no token', null],
    ['forged', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['replayed', { success: false, 'error-codes': ['timeout-or-duplicate'] }],
    ['unexplained', { success: false }],
  ]

  it('says the same sentence whatever went wrong', async () => {
    configure()
    const bodies: string[] = []

    for (const [, reply] of reasons) {
      await reset()
      vi.unstubAllGlobals()
      if (reply !== null) stubSiteverify(() => ok(reply))
      const fields = reply === null ? signupFields() : signupFields({ 'cf-turnstile-response': TOKEN })
      const res = await handleRegister(post('/register', fields), env)
      expect(res.status).toBe(400)
      bodies.push(await res.text())
    }

    // Byte-identical, not merely "similar wording" — the same discipline
    // /login is held to, and for the same reason.
    for (const body of bodies) expect(body).toBe(bodies[0])
  })

  it('never echoes the challenge token back into the page', async () => {
    // /recover already refuses to echo a gate token into an error page. Same
    // rule: a credential that was submitted does not get printed back out.
    configure()
    stubSiteverify(() => ok({ success: false, 'error-codes': ['invalid-input-response'] }))

    const html = await (
      await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)
    ).text()

    expect(html).not.toContain(TOKEN)
  })

  it('keeps the typed address and name so the retry is one tap', async () => {
    configure()
    stubSiteverify(() => ok({ success: false, 'error-codes': ['invalid-input-response'] }))

    const html = await (
      await handleRegister(post('/register', signupFields({ 'cf-turnstile-response': TOKEN })), env)
    ).text()

    expect(html).toContain('value="someone@example.com"')
    expect(html).toContain('value="某人"')
    // And a fresh widget to solve, or the retry is impossible.
    expect(html).toContain('cf-turnstile')
  })

  it('escapes the site key rather than trusting the environment', async () => {
    env.TURNSTILE_SITE_KEY = '"><img src=x onerror=alert(1)>'
    env.TURNSTILE_SECRET = SECRET

    const html = await (await handleRegister(new Request(`${BASE}/register`), env)).text()
    expect(html).not.toContain('<img src=x')
  })
})

// --- 5. one page, one origin ------------------------------------------------

describe('the widget is on /register and nowhere else', () => {
  it('renders on /register when configured', async () => {
    configure()
    const res = await handleRegister(new Request(`${BASE}/register`), env)
    const html = await res.text()

    expect(html).toContain(`data-sitekey="${SITE_KEY}"`)
    expect(html).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js')
    // Implicit rendering: the script injects the hidden input itself, so this
    // stays a plain POST/redirect/GET form with no JavaScript of ours.
    expect(html).toContain('class="cf-turnstile"')
    expect(html).toContain('data-action="turnstile-spin-v1"')
  })

  it('stays off /login, /claim and /recover even when configured', async () => {
    // Each was considered and rejected: /login would tax a mistyped password,
    // and /claim and /recover already require an unguessable 128-bit token.
    configure()
    const pages: Array<[string, Response]> = [
      ['/login', await handleLogin(new Request(`${BASE}/login`), env)],
      ['/claim', await handleClaim(new Request(`${BASE}/claim`), env)],
      ['/recover', await handleRecover(new Request(`${BASE}/recover`), env)],
    ]

    for (const [path, res] of pages) {
      const html = await res.text()
      expect(html, path).not.toContain('cf-turnstile')
      expect(html, path).not.toContain('challenges.cloudflare.com')
      expect(res.headers.get('content-security-policy'), path).not.toContain('challenges.cloudflare.com')
    }
  })

  it('keeps every other page on default-src none with no exceptions', async () => {
    configure()
    for (const path of ['/', '/login', '/claim', '/recover']) {
      const res = await worker.fetch(new Request(`${BASE}${path}`), env)
      const csp = res.headers.get('content-security-policy')
      expect(csp, path).toBe(
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
          "connect-src 'self'; img-src data:; manifest-src 'self'; base-uri 'none'; " +
          "form-action 'self'; frame-ancestors 'none'",
      )
    }
  })
})

describe('the CSP on /register', () => {
  it('adds exactly one origin, to exactly three directives', async () => {
    configure()
    const res = await handleRegister(new Request(`${BASE}/register`), env)
    const csp = res.headers.get('content-security-policy') ?? ''

    expect(csp).toBe(
      "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; " +
        "style-src 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; " +
        "img-src data:; manifest-src 'self'; base-uri 'none'; form-action 'self'; " +
        'frame-ancestors \'none\'; frame-src https://challenges.cloudflare.com',
    )
  })

  it('names no host other than challenges.cloudflare.com', async () => {
    configure()
    const csp = (await handleRegister(new Request(`${BASE}/register`), env)).headers.get(
      'content-security-policy',
    ) ?? ''

    // The invariant, rather than a diff of the string above: whatever hosts the
    // policy mentions, there is one of them and it is Cloudflare's.
    const hosts = [...csp.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0])
    expect(new Set(hosts)).toEqual(new Set(['https://challenges.cloudflare.com']))
  })

  it('reverts to the untouched policy the moment the keys go away', async () => {
    const withKeys = (
      await (async () => {
        configure()
        return await handleRegister(new Request(`${BASE}/register`), env)
      })()
    ).headers.get('content-security-policy')

    env.TURNSTILE_SITE_KEY = ''
    env.TURNSTILE_SECRET = ''
    const without = (await handleRegister(new Request(`${BASE}/register`), env)).headers.get(
      'content-security-policy',
    )

    expect(withKeys).not.toBe(without)
    expect(without).not.toContain('challenges.cloudflare.com')
  })

  it('still forbids frames on /register itself', async () => {
    // frame-src opens outbound frames; frame-ancestors must stay shut so this
    // page cannot be embedded in somebody else's.
    configure()
    const csp = (await handleRegister(new Request(`${BASE}/register`), env)).headers.get(
      'content-security-policy',
    ) ?? ''
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("form-action 'self'")
  })
})

// --- 6. the throttle is still there ----------------------------------------

describe('Turnstile sits on top of the per-IP throttle, not instead of it', () => {
  it('still throttles /register after five attempts from one address', async () => {
    configure()
    stubSiteverify(() => ok({ success: true }))

    const attempt = (n: number): Promise<Response> =>
      worker.fetch(
        new Request(`${BASE}/register`, {
          method: 'POST',
          headers: { 'CF-Connecting-IP': '203.0.113.9' },
          body: new URLSearchParams(signupFields({ email: `n${n}@example.com`, 'cf-turnstile-response': TOKEN })),
        }),
        env,
      )

    for (let n = 0; n < 5; n++) expect((await attempt(n)).status).toBe(303)
    expect((await attempt(5)).status).toBe(429)
  })
})

// --- 7. the verifier on its own --------------------------------------------

describe('verifyTurnstile', () => {
  it('reports which fail-open path it took, and nothing about a rejection', async () => {
    // The asymmetry is deliberate: the allow branch carries a reason for the
    // log, the reject branch carries none, so no caller can word rejections
    // apart even by accident.
    expect(await verifyTurnstile(null, '')).toEqual({ allow: true, why: 'not_configured' })

    stubSiteverify(() => ok({ success: true }))
    expect(await verifyTurnstile({ siteKey: SITE_KEY, secret: SECRET }, TOKEN)).toEqual({
      allow: true,
      why: 'verified',
    })

    vi.unstubAllGlobals()
    stubSiteverify(() => ok({ success: false, 'error-codes': ['invalid-input-response'] }))
    expect(await verifyTurnstile({ siteKey: SITE_KEY, secret: SECRET }, TOKEN)).toEqual({ allow: false })
  })

  it('ignores a token when there are no keys, rather than calling out', async () => {
    const seen = stubSiteverify(() => ok({ success: true }))
    expect(await verifyTurnstile(null, TOKEN)).toEqual({ allow: true, why: 'not_configured' })
    expect(seen).toEqual([])
  })

  it('does not read a non-array error-codes as a licence to pass', async () => {
    stubSiteverify(() => ok({ success: false, 'error-codes': 'internal-error' }))
    expect(await verifyTurnstile({ siteKey: SITE_KEY, secret: SECRET }, TOKEN)).toEqual({ allow: false })
  })

  it('needs every code to be ours before it fails open', async () => {
    // One client-inducible code in the list is enough to make the whole answer
    // a verdict rather than an outage.
    stubSiteverify(() =>
      ok({ success: false, 'error-codes': ['internal-error', 'invalid-input-response'] }),
    )
    expect(await verifyTurnstile({ siteKey: SITE_KEY, secret: SECRET }, TOKEN)).toEqual({ allow: false })
  })

  it('treats a truthy-but-not-true success as a failure', async () => {
    stubSiteverify(() => ok({ success: 'true' }))
    expect(await verifyTurnstile({ siteKey: SITE_KEY, secret: SECRET }, TOKEN)).toEqual({ allow: false })
  })
})
