// The account pages, tested for the four things that are properties of the
// product rather than of the markup:
//
//   1. /register tells the truth about the recovery loop *before* the form,
//      including the part where losing both secrets is unrecoverable.
//   2. A failed login is byte-identical whether the address exists or not.
//      /review is a log of somebody's worst impulses; "does this person use
//      一息" is itself worth hiding, and a difference of one word gives it away.
//   3. The account page does not contain the gate token until asked. Not
//      masked with CSS over a value sitting in the markup — absent.
//   4. Every user-supplied string is escaped, and no page is cacheable.

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleAccount, handleClaim, handleLogin, handleRecover, handleRegister } from '../src/ui/account'
import { renderSetup } from '../src/ui/setup'
import { renderLanding } from '../src/ui/landing'
import { register } from '../src/account'
import { sha256Hex } from '../src/auth'
import type { User } from '../src/types'

const BASE = 'https://yixi.example.workers.dev'
const PASSWORD = 'correct-horse-battery'

function get(path: string, init?: RequestInit): Request {
  return new Request(`${BASE}${path}`, init)
}

function post(path: string, fields: Record<string, string>): Request {
  return new Request(`${BASE}${path}`, { method: 'POST', body: new URLSearchParams(fields) })
}

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions_web'),
    env.DB.prepare('DELETE FROM user_apps'),
    env.DB.prepare('DELETE FROM users'),
  ])
}
beforeEach(reset)

interface Signup {
  user: User
  token: string
}

async function signUp(email = 'real@example.com', password = PASSWORD, name?: string): Promise<Signup> {
  const res = await register(env, { email, password, name })
  if (!res.ok) throw new Error(`register failed: ${res.error}`)
  return { user: res.user, token: res.token }
}

/** A row from the ticket-window era: a token hash and nothing else. */
async function seedLegacyUser(token: string, name = '老王'): Promise<User> {
  const created = 1_700_000_000_000
  const res = await env.DB.prepare(
    'INSERT INTO users (name, token_hash, is_owner, created_at) VALUES (?1, ?2, 0, ?3)',
  )
    .bind(name, await sha256Hex(token), created)
    .run()
  return { id: Number(res.meta.last_row_id), name, is_owner: 0, created_at: created }
}

// --- 1. the register page has to state the price ---------------------------

describe('/register', () => {
  it('spells out all three branches of the recovery loop, dead end included', async () => {
    const html = await (await handleRegister(get('/register'), env)).text()

    expect(html).toContain('没有邮件服务')
    // forgot the password -> reset with the token
    expect(html).toContain('忘了密码')
    expect(html).toContain('/recover')
    // forgot the token -> sign in and read it back
    expect(html).toContain('忘了 token')
    // lost both -> nothing
    expect(html).toContain('两样都丢了')
    expect(html).toContain('没有办法')
  })

  it('puts the price above the form, not below it', async () => {
    const html = await (await handleRegister(get('/register'), env)).text()

    // A phone screen shows roughly one card. If the dead end renders after the
    // submit button, the people who most need to read it never will — so the
    // ordering is asserted rather than left to whoever edits this page next.
    expect(html.indexOf('两样都丢了')).toBeGreaterThan(-1)
    expect(html.indexOf('两样都丢了')).toBeLessThan(html.indexOf('action="/register"'))
  })

  it('points a token holder at /claim instead of letting them register a second identity', async () => {
    const html = await (await handleRegister(get('/register'), env)).text()
    // Registering afresh mints a *different* token, silently abandoning their
    // history and app config. The page has to say so where they will see it.
    expect(html).toContain('/claim')
    expect(html).toContain('旧记录就找不回来')
  })

  it('signs the new account in and redirects, rather than rendering from the POST', async () => {
    const res = await handleRegister(
      post('/register', { email: 'new@example.com', password: PASSWORD, password2: PASSWORD }),
      env,
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/account?new=1')
    expect(res.headers.get('set-cookie')).toMatch(/^yixi=[0-9a-f]{32};/)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects a mistyped confirmation without creating anything', async () => {
    const res = await handleRegister(
      post('/register', { email: 'new@example.com', password: PASSWORD, password2: `${PASSWORD}x` }),
      env,
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('两次输入的密码不一样')
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
    expect(row?.n).toBe(0)
  })
})

// --- 2. a failed login must not answer "does this address exist" -----------

describe('/login', () => {
  it('answers a wrong password and an unknown address with the identical page', async () => {
    const email = 'real@example.com'
    const attempt = { email, password: 'not-the-password' }

    await signUp(email)
    const wrongPassword = await handleLogin(post('/login', attempt), env)
    const wrongPasswordHtml = await wrongPassword.text()

    // Same submitted address, same form; only the database differs.
    await reset()
    const unknownEmail = await handleLogin(post('/login', attempt), env)
    const unknownEmailHtml = await unknownEmail.text()

    expect(unknownEmail.status).toBe(wrongPassword.status)
    expect(unknownEmailHtml).toBe(wrongPasswordHtml)
    expect(wrongPasswordHtml).toContain('邮箱或密码不对')
  })

  it('never hints at which half was wrong', async () => {
    const html = await (await handleLogin(post('/login', { email: 'nobody@example.com', password: 'x'.repeat(12) }), env)).text()
    for (const leak of ['没注册', '不存在', '没有这个', '密码错', '用户不存在']) {
      expect(html).not.toContain(leak)
    }
  })

  it('lets a correct password through and sends it to the ledger', async () => {
    await signUp()
    const res = await handleLogin(post('/login', { email: 'real@example.com', password: PASSWORD }), env)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/review')
    expect(res.headers.get('set-cookie')).toMatch(/^yixi=[0-9a-f]{32};/)
  })

  it('does not trim the password, since trimming one silently changes it', async () => {
    await signUp('spaced@example.com', ' pad ded pw ')
    const bad = await handleLogin(post('/login', { email: 'spaced@example.com', password: 'pad ded pw' }), env)
    expect(bad.status).toBe(401)
    const good = await handleLogin(post('/login', { email: 'spaced@example.com', password: ' pad ded pw ' }), env)
    expect(good.status).toBe(303)
  })
})

// --- 3. the token is absent until it is asked for --------------------------

describe('/account token', () => {
  it('does not put the token anywhere in the default page', async () => {
    const { user, token } = await signUp()
    const res = await handleAccount(get('/account'), env, user)
    const html = await res.text()

    // Not "hidden", not blurred, not in a data- attribute: not present. The
    // reveal is a separate request that goes and fetches it.
    expect(html).not.toContain(token)
    expect(html).toContain('••••')
    expect(html).toContain('/account?show=1')
    // No script either: with nothing to copy there is nothing for one to do.
    expect(html).not.toContain('<script')
  })

  it('prints it on the reveal request, with a way to copy and a way to hide again', async () => {
    const { user, token } = await signUp()
    const html = await (await handleAccount(get('/account?show=1'), env, user)).text()

    expect(html).toContain(token)
    expect(html).toContain('id="cp"')
    expect(html).toContain('藏起来')
    expect(html).toContain('navigator.clipboard')
  })

  it('says it cannot show a token it has no sealed copy of', async () => {
    const legacy = await seedLegacyUser('a'.repeat(32))
    const html = await (await handleAccount(get('/account?show=1'), env, legacy)).text()

    expect(html).toContain('打不开你的 token 原文')
    expect(html).toContain('/claim')
  })

  it('offers a legacy token holder a password instead of a change-password form', async () => {
    const legacy = await seedLegacyUser('b'.repeat(32))
    const html = await (await handleAccount(get('/account'), env, legacy)).text()

    expect(html).toContain('还没有密码')
    expect(html).not.toContain('当前密码')
  })
})

// --- the two write paths on /account ---------------------------------------

describe('/account writes', () => {
  it('changes a password and hands back a cookie, since the change kills every session', async () => {
    const { user } = await signUp()
    const res = await handleAccount(
      post('/account', { op: 'password', current: PASSWORD, password: 'a-brand-new-one', password2: 'a-brand-new-one' }),
      env,
    user)

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/account?saved=1')
    // Without this the redirect lands on a 401: changePassword revokes the very
    // session that made the request.
    expect(res.headers.get('set-cookie')).toMatch(/^yixi=[0-9a-f]{32};/)

    expect((await handleLogin(post('/login', { email: 'real@example.com', password: 'a-brand-new-one' }), env)).status).toBe(303)
    expect((await handleLogin(post('/login', { email: 'real@example.com', password: PASSWORD }), env)).status).toBe(401)
  })

  it('blames the current-password box rather than an email that is not on this form', async () => {
    const { user } = await signUp()
    const res = await handleAccount(
      post('/account', { op: 'password', current: 'wrong-one-here', password: 'a-brand-new-one', password2: 'a-brand-new-one' }),
      env,
      user,
    )
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain('当前密码不对')
    expect(html).not.toContain('邮箱或密码不对')
  })

  it('clears the cookie on sign-out', async () => {
    const { user } = await signUp()
    const res = await handleAccount(post('/account', { op: 'logout' }), env, user)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

// --- /recover and /claim ---------------------------------------------------

describe('/recover', () => {
  it('resets with the token and signs the browser in', async () => {
    const { token } = await signUp()
    const res = await handleRecover(
      post('/recover', { token, password: 'a-brand-new-one', password2: 'a-brand-new-one' }),
      env,
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/account?reset=1')
    expect((await handleLogin(post('/login', { email: 'real@example.com', password: 'a-brand-new-one' }), env)).status).toBe(303)
  })

  it('tolerates a token pasted with a stray space, the classic failure here', async () => {
    const { token } = await signUp()
    const res = await handleRecover(
      post('/recover', { token: ` ${token} `, password: 'a-brand-new-one', password2: 'a-brand-new-one' }),
      env,
    )
    expect(res.status).toBe(303)
  })

  it('does not echo a rejected token back into the markup', async () => {
    const wrong = 'f'.repeat(32)
    const res = await handleRecover(
      post('/recover', { token: wrong, password: 'a-brand-new-one', password2: 'a-brand-new-one' }),
      env,
    )
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain('这个 token 不对')
    // Somebody else's gate credential must not end up sitting in an error page.
    expect(html).not.toContain(wrong)
  })
})

describe('/claim', () => {
  it('binds an account onto an old token without changing the identity behind it', async () => {
    const token = 'c'.repeat(32)
    const legacy = await seedLegacyUser(token)

    const res = await handleClaim(
      post('/claim', { token, email: 'wang@example.com', password: PASSWORD, password2: PASSWORD }),
      env,
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/account?claimed=1')

    // Same row, so their history, app config and is_owner flag survive.
    const row = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?1').bind(legacy.id).first<{ id: number; email: string }>()
    expect(row?.email).toBe('wang@example.com')

    // And the page can now show them the token it could not show before.
    const html = await (await handleAccount(get('/account?show=1'), env, legacy)).text()
    expect(html).toContain(token)
  })
})

// --- 4. escaping and caching ------------------------------------------------

describe('escaping', () => {
  it('escapes the email echoed back into a failed login', async () => {
    const evil = '"><img/src=x/onerror=alert(1)>@e.com'
    const html = await (await handleLogin(post('/login', { email: evil, password: 'x'.repeat(12) }), env)).text()

    expect(html).not.toContain('<img/src=x')
    expect(html).not.toContain('"><img')
    expect(html).toContain('&lt;img/src=x')
  })

  it('escapes the email and name echoed back into a failed registration', async () => {
    const html = await (
      await handleRegister(
        post('/register', {
          email: '<img/src=x>@e.com',
          name: '</title><script>alert(1)</script>',
          password: 'short',
          password2: 'short',
        }),
        env,
      )
    ).text()

    expect(html).not.toContain('<script>alert(1)')
    expect(html).not.toContain('<img/src=x>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes the stored name and email on the account page', async () => {
    const { user } = await signUp('<img/src=x>@e.com', PASSWORD, '</span><b>粗体')
    const html = await (await handleAccount(get('/account'), env, user)).text()

    expect(html).not.toContain('</span><b>粗体')
    expect(html).not.toContain('<img/src=x>@e.com')
    expect(html).toContain('&lt;/span&gt;&lt;b&gt;粗体')
    expect(html).toContain('&lt;img/src=x&gt;@e.com')
  })
})

describe('caching', () => {
  it('marks every account page no-store', async () => {
    const { user } = await signUp()
    const responses = [
      await handleRegister(get('/register'), env),
      await handleLogin(get('/login'), env),
      await handleRecover(get('/recover'), env),
      await handleClaim(get('/claim'), env),
      await handleAccount(get('/account'), env, user),
      await handleAccount(get('/account?show=1'), env, user),
    ]
    for (const res of responses) {
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('marks the redirects no-store too, since they carry a Set-Cookie', async () => {
    const res = await handleRegister(
      post('/register', { email: 'new@example.com', password: PASSWORD, password2: PASSWORD }),
      env,
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

// --- the two pages that had to change with them ----------------------------

describe('/setup after accounts', () => {
  it('keeps the token out of the page until it is asked for', async () => {
    const { user, token } = await signUp()
    const html = await (await renderSetup(get('/setup'), env, user)).text()

    // Not merely hidden with CSS — absent. This page is one nav tap from every
    // other console page, so an unlocked phone left on a desk must not be
    // showing somebody's key.
    expect(html).not.toContain(token)
    expect(html).toContain('/setup?show=1')
  })

  it('prints the real token for a signed-in holder who asks, with no ?k= needed', async () => {
    const { user, token } = await signUp()
    await env.DB.prepare(
      `INSERT INTO user_apps (user_id, app, label, scheme, wait_seconds, grace_seconds, enabled)
       VALUES (?1, 'xhs', '小红书', 'xhsdiscover://', 10, 90, 1)`,
    )
      .bind(user.id)
      .run()
    const html = await (await renderSetup(get('/setup?show=1'), env, user)).text()

    // This is the whole point of sealing a copy: the ordinary way to reach this
    // page used to be the way it could not finish the job.
    expect(html).toContain(token)
    // The sealed copy is what makes the paste-ready line possible at all: before
    // accounts, reaching this page the ordinary way could not finish the job.
    expect(html).toContain(`&amp;k=${token}&amp;fmt=text`)
  })

  it('still refuses to invent one for a row with no sealed copy', async () => {
    const legacy = await seedLegacyUser('d'.repeat(32))
    const html = await (await renderSetup(get('/setup?show=1'), env, legacy)).text()

    // Asked for, and genuinely unavailable — a different thing from "not asked
    // for yet", and it must not be reported as the same.
    expect(html).toContain('读不到你的 token 原文')
    expect(html).toContain('/claim')
  })

  it('lets ?k= win over the sealed copy', async () => {
    const { user } = await signUp()
    const html = await (await renderSetup(get('/setup?k=deadbeef00112233'), env, user)).text()
    expect(html).toContain('deadbeef00112233')
  })
})

describe('/', () => {
  it('offers the two front doors that replaced asking the owner for a token', async () => {
    const html = await renderLanding(new URL('https://yixi.example/')).text()
    expect(html).toContain('href="/register"')
    expect(html).toContain('href="/login"')
    expect(html).toContain('href="/claim"')
  })

  it('admits that a readable copy of the token is weaker than a hash', async () => {
    const html = await renderLanding(new URL('https://yixi.example/')).text()
    expect(html).toContain('加密存在服务器上')
    expect(html).toContain('数据库和密钥同时泄露')
    // The guarantee that did not change.
    expect(html).toContain('看不到任何一条明细')
  })
})
