// Accounts exist so that a lost token is recoverable. That convenience is only
// safe if three things stay true, and each has its own block below:
//
//   1. The two copies of the token — the hash /gate verifies and the sealed
//      copy an owner reads back — never drift apart.
//   2. A stranger cannot learn from a failed login whether an address is
//      registered. /review is a log of somebody's worst impulses; "does this
//      person use 一息" is already too much to give away.
//   3. A password change or reset really does end the other sessions. That is
//      the entire reason the cookie stopped being stateless.
//
// The last block is a regression guard on /gate: adding accounts must not have
// changed one byte of the hot path a phone hits every time it opens an app.

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  accountSummary,
  changePassword,
  claimAccount,
  login,
  logout,
  register,
  resetPasswordWithToken,
  revealToken,
} from '../src/account'
import { COOKIE_NAME, authenticate, sha256Hex } from '../src/auth'
import { handleGate } from '../src/gate'
import { openToken } from '../src/crypto'
import type { GateDecision, User } from '../src/types'

const EMAIL = 'alice@example.com'
const PASSWORD = 'a-good-enough-password'

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM grace'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM sessions_web'),
    env.DB.prepare('DELETE FROM user_apps'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

beforeEach(reset)

/** A row as the old ticket window made them: a token, no email, no password. */
async function seedLegacyUser(token: string, name = 'legacy', isOwner = 0): Promise<number> {
  const res = await env.DB.prepare(
    'INSERT INTO users (name, token_hash, is_owner, created_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(name, await sha256Hex(token), isOwner, Date.now())
    .run()
  return Number(res.meta.last_row_id)
}

async function seedApp(userId: number, app: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_apps (user_id, app, label, scheme, wait_seconds, grace_seconds, enabled)
     VALUES (?1, ?2, ?3, ?4, 10, 90, 1)`,
  )
    .bind(userId, app, app.toUpperCase(), `${app}://`)
    .run()
}

/** Strips `name=` and the attributes off a Set-Cookie value. */
function cookieValue(setCookie: string): string {
  const first = setCookie.split(';')[0] ?? ''
  return first.slice(first.indexOf('=') + 1)
}

function requestWith(cookie: string, path = '/review'): Request {
  return new Request(`https://yixi.test${path}`, { headers: { Cookie: `${COOKIE_NAME}=${cookie}` } })
}

/** Whether a Set-Cookie still opens a page. */
async function stillSignedIn(setCookie: string): Promise<User | null> {
  const auth = await authenticate(requestWith(cookieValue(setCookie)), env)
  return auth?.user ?? null
}

async function registerAlice(over: { email?: string; password?: string; name?: string } = {}) {
  const res = await register(env, {
    email: over.email ?? EMAIL,
    password: over.password ?? PASSWORD,
    ...(over.name === undefined ? {} : { name: over.name }),
  })
  if (!res.ok) throw new Error(`expected registration to succeed, got ${res.error}`)
  return res
}

async function storedRow(userId: number) {
  return await env.DB.prepare(
    'SELECT id, name, email, is_owner, token_hash, token_cipher, token_iv, password_hash, password_salt, password_iters FROM users WHERE id = ?1',
  )
    .bind(userId)
    .first<{
      id: number
      name: string
      email: string | null
      is_owner: number
      token_hash: string
      token_cipher: string | null
      token_iv: string | null
      password_hash: string | null
      password_salt: string | null
      password_iters: number | null
    }>()
}

// --------------------------------------------------------------------------

describe('register — the two copies of one token', () => {
  it('writes a hash /gate can verify and a sealed copy the owner can read, both of the same token', async () => {
    const res = await registerAlice()

    const row = (await storedRow(res.user.id))!
    // Path one: the credential /gate compares against.
    expect(row.token_hash).toBe(await sha256Hex(res.token))
    // Path two: the copy that makes the account worth having.
    expect(await openToken(env.TOKEN_KEY, { cipher: row.token_cipher!, iv: row.token_iv! })).toBe(res.token)
  })

  it('is a 128-bit token, and the plaintext is written nowhere', async () => {
    const res = await registerAlice()

    const row = (await storedRow(res.user.id))!
    expect(res.token).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.stringify(row)).not.toContain(res.token)
  })

  it('reads the token back through the account, which is the point of the feature', async () => {
    const res = await registerAlice()

    expect(await revealToken(env, res.user)).toBe(res.token)
  })

  it('stores the password as a salted hash, never the password', async () => {
    const res = await registerAlice()

    const row = (await storedRow(res.user.id))!
    expect(row.password_hash).toBeTruthy()
    expect(row.password_salt).toBeTruthy()
    expect(row.password_iters).toBeGreaterThan(0)
    expect(JSON.stringify(row)).not.toContain(PASSWORD)
  })

  it('signs the new account in immediately', async () => {
    const res = await registerAlice()

    expect(await stillSignedIn(res.setCookie)).toMatchObject({ id: res.user.id })
  })

  it('lowercases and trims the email, and defaults the name to the local part', async () => {
    const res = await registerAlice({ email: '  Alice@Example.COM ' })

    const row = (await storedRow(res.user.id))!
    expect(row.email).toBe(EMAIL)
    expect(row.name).toBe('alice')
    // ...and the stored form is what a login has to match, whatever case it arrives in.
    expect((await login(env, { email: 'ALICE@example.com', password: PASSWORD })).ok).toBe(true)
  })

  it('honours an explicit name and never marks a self-signup as owner', async () => {
    const res = await registerAlice({ name: '老王' })

    const row = (await storedRow(res.user.id))!
    expect(row.name).toBe('老王')
    expect(row.is_owner).toBe(0)
  })

  it('rejects a malformed email, a short password and an over-long name', async () => {
    expect(await register(env, { email: 'not-an-email', password: PASSWORD })).toEqual({
      ok: false,
      error: 'invalid_email',
    })
    expect(await register(env, { email: EMAIL, password: 'short' })).toEqual({
      ok: false,
      error: 'weak_password',
    })
    expect(await register(env, { email: EMAIL, password: PASSWORD, name: 'x'.repeat(41) })).toEqual({
      ok: false,
      error: 'invalid_name',
    })

    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
    expect(n?.n).toBe(0)
  })
})

describe('register — email uniqueness', () => {
  it('answers a duplicate with a friendly error rather than blowing up', async () => {
    await registerAlice()

    const again = await register(env, { email: EMAIL, password: 'another-password-entirely' })

    // The failure has to be a value, not a throw: this is an ordinary thing for
    // a stranger to do, and a 500 would tell them nothing and page nobody.
    expect(again).toEqual({ ok: false, error: 'email_taken' })
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
    expect(n?.n).toBe(1)
  })

  it('catches the duplicate whatever case it is typed in', async () => {
    await registerAlice()

    expect(await register(env, { email: 'ALICE@EXAMPLE.COM', password: PASSWORD })).toEqual({
      ok: false,
      error: 'email_taken',
    })
  })

  it('lets rows that predate accounts coexist — their NULL emails must not collide', async () => {
    // The unique index is partial for exactly this reason; a plain one would
    // make the second of these rows impossible to insert.
    await seedLegacyUser('token-one')
    await seedLegacyUser('token-two')

    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE email IS NULL').first<{ n: number }>()
    expect(n?.n).toBe(2)
  })
})

describe('login', () => {
  it('accepts the right password and hands back a working session', async () => {
    const registered = await registerAlice()

    const res = await login(env, { email: EMAIL, password: PASSWORD })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.user.id).toBe(registered.user.id)
    expect(await stillSignedIn(res.setCookie)).toMatchObject({ id: registered.user.id })
  })

  it('answers a wrong password and an unknown address identically', async () => {
    await registerAlice()

    const wrongPassword = await login(env, { email: EMAIL, password: 'not-the-password' })
    const unknownEmail = await login(env, { email: 'nobody@example.com', password: PASSWORD })
    const malformedEmail = await login(env, { email: 'nonsense', password: PASSWORD })

    // Byte-identical results. Anything that distinguishes these three is a
    // registry of who uses this app, readable by anyone with a browser.
    expect(wrongPassword).toEqual({ ok: false, error: 'invalid_credentials' })
    expect(unknownEmail).toEqual(wrongPassword)
    expect(malformedEmail).toEqual(wrongPassword)
  })

  it('refuses a row that has a token but no password', async () => {
    await seedLegacyUser('legacy-token')

    expect(await login(env, { email: '', password: '' })).toEqual({ ok: false, error: 'invalid_credentials' })
  })

  it('keeps two accounts apart', async () => {
    const alice = await registerAlice()
    const bob = await registerAlice({ email: 'bob@example.com', password: 'bobs-own-password' })

    const asBob = await login(env, { email: 'bob@example.com', password: 'bobs-own-password' })

    expect(asBob.ok && asBob.user.id).toBe(bob.user.id)
    expect(bob.user.id).not.toBe(alice.user.id)
    // Alice's password does not open Bob's account.
    expect(await login(env, { email: 'bob@example.com', password: PASSWORD })).toEqual({
      ok: false,
      error: 'invalid_credentials',
    })
  })
})

describe('sessions', () => {
  it('stops accepting a session once it has expired', async () => {
    const res = await registerAlice()
    expect(await stillSignedIn(res.setCookie)).not.toBeNull()

    await env.DB.prepare('UPDATE sessions_web SET expires_at = ?1').bind(Date.now() - 1).run()

    // The row is still there; the check is server-side, so a browser holding on
    // to the cookie past its Max-Age gains nothing.
    expect(await stillSignedIn(res.setCookie)).toBeNull()
  })

  it('rejects a cookie whose row was deleted, and any value that is not a session id', async () => {
    const res = await registerAlice()
    await env.DB.prepare('DELETE FROM sessions_web').run()

    expect(await stillSignedIn(res.setCookie)).toBeNull()
    expect(await authenticate(requestWith('garbage'), env)).toBeNull()
    expect(await authenticate(requestWith(''), env)).toBeNull()
    // An old stateless cookie — `<id>.<expiry>.<sig>` — is not a session id and
    // must not be honoured; it could not be revoked, which is why it is gone.
    expect(await authenticate(requestWith(`${res.user.id}.${Date.now() + 60_000}.c2ln`), env)).toBeNull()
  })

  it('rejects a session whose user has been deleted', async () => {
    const res = await registerAlice()

    await env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(res.user.id).run()

    expect(await stillSignedIn(res.setCookie)).toBeNull()
  })

  it('signs out one browser without touching the others', async () => {
    const first = await registerAlice()
    const second = await login(env, { email: EMAIL, password: PASSWORD })
    if (!second.ok) throw new Error('login failed')

    const cleared = await logout(env, cookieValue(first.setCookie))

    expect(cleared).toContain('Max-Age=0')
    expect(await stillSignedIn(first.setCookie)).toBeNull()
    expect(await stillSignedIn(second.setCookie)).not.toBeNull()
  })

  it('seeds a session from ?k=, so the token can stop living in the URL', async () => {
    const res = await registerAlice()

    const auth = await authenticate(new Request(`https://yixi.test/review?k=${res.token}`), env)

    expect(auth).toMatchObject({ seededFromToken: true, via: 'token', sessionId: null })
    expect(auth?.user.id).toBe(res.user.id)
  })
})

describe('resetting the password with the gate token', () => {
  it('sets a new password and ends every existing session', async () => {
    const registered = await registerAlice()
    const other = await login(env, { email: EMAIL, password: PASSWORD })
    if (!other.ok) throw new Error('login failed')

    const res = await resetPasswordWithToken(env, { token: registered.token, password: 'a-brand-new-password' })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    // Whoever knew the old password is out of both browsers — the point of the
    // reset, and the thing a stateless cookie could not deliver.
    expect(await stillSignedIn(registered.setCookie)).toBeNull()
    expect(await stillSignedIn(other.setCookie)).toBeNull()
    // ...and the session this call handed back, minted after the purge, works.
    expect(await stillSignedIn(res.setCookie)).toMatchObject({ id: registered.user.id })

    expect(await login(env, { email: EMAIL, password: 'a-brand-new-password' })).toMatchObject({ ok: true })
    expect(await login(env, { email: EMAIL, password: PASSWORD })).toEqual({
      ok: false,
      error: 'invalid_credentials',
    })
  })

  it('leaves the gate token itself alone — the two secrets are independent', async () => {
    const registered = await registerAlice()

    await resetPasswordWithToken(env, { token: registered.token, password: 'a-brand-new-password' })

    const row = (await storedRow(registered.user.id))!
    expect(row.token_hash).toBe(await sha256Hex(registered.token))
    expect(await revealToken(env, registered.user)).toBe(registered.token)
  })

  it('rejects a wrong token without changing anything or signing anyone out', async () => {
    const registered = await registerAlice()

    const res = await resetPasswordWithToken(env, { token: 'not-the-token', password: 'a-brand-new-password' })

    expect(res).toEqual({ ok: false, error: 'invalid_token' })
    expect(await stillSignedIn(registered.setCookie)).not.toBeNull()
    expect(await login(env, { email: EMAIL, password: PASSWORD })).toMatchObject({ ok: true })
  })

  it('rejects a weak new password, and one whose token has no account behind it', async () => {
    const registered = await registerAlice()
    await seedLegacyUser('legacy-token')

    expect(await resetPasswordWithToken(env, { token: registered.token, password: 'short' })).toEqual({
      ok: false,
      error: 'weak_password',
    })
    // Setting a password on a row with no email would leave the holder with a
    // credential they have no way to present.
    expect(await resetPasswordWithToken(env, { token: 'legacy-token', password: 'a-brand-new-password' })).toEqual({
      ok: false,
      error: 'no_account',
    })
  })
})

describe('changing the password while signed in', () => {
  it('requires the current password, then ends the other sessions and keeps this one', async () => {
    const registered = await registerAlice()
    const other = await login(env, { email: EMAIL, password: PASSWORD })
    if (!other.ok) throw new Error('login failed')

    const res = await changePassword(env, {
      user: registered.user,
      currentPassword: PASSWORD,
      newPassword: 'a-brand-new-password',
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(await stillSignedIn(other.setCookie)).toBeNull()
    expect(await stillSignedIn(registered.setCookie)).toBeNull()
    expect(await stillSignedIn(res.setCookie)).toMatchObject({ id: registered.user.id })
    expect(await login(env, { email: EMAIL, password: 'a-brand-new-password' })).toMatchObject({ ok: true })
  })

  it('rejects a wrong current password and changes nothing', async () => {
    const registered = await registerAlice()

    const res = await changePassword(env, {
      user: registered.user,
      currentPassword: 'not-the-password',
      newPassword: 'a-brand-new-password',
    })

    expect(res).toEqual({ ok: false, error: 'invalid_credentials' })
    expect(await stillSignedIn(registered.setCookie)).not.toBeNull()
    expect(await login(env, { email: EMAIL, password: PASSWORD })).toMatchObject({ ok: true })
  })

  it('rejects a weak new password, and a user with no account to change', async () => {
    const registered = await registerAlice()
    const legacyId = await seedLegacyUser('legacy-token')

    expect(
      await changePassword(env, { user: registered.user, currentPassword: PASSWORD, newPassword: 'short' }),
    ).toEqual({ ok: false, error: 'weak_password' })
    expect(
      await changePassword(env, {
        user: { id: legacyId, name: 'legacy', is_owner: 0, created_at: Date.now() },
        currentPassword: '',
        newPassword: 'a-brand-new-password',
      }),
    ).toEqual({ ok: false, error: 'no_account' })
  })
})

describe('claiming a token that predates accounts', () => {
  it('binds an account to the existing row, keeping the id, the owner flag and the history', async () => {
    const legacyId = await seedLegacyUser('legacy-token', 'owner', 1)

    const res = await claimAccount(env, { token: 'legacy-token', email: EMAIL, password: PASSWORD })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    // Same row: registering afresh would mint a different token and orphan
    // everything this person has recorded so far.
    expect(res.user.id).toBe(legacyId)
    expect(res.user.is_owner).toBe(1)
    expect(await stillSignedIn(res.setCookie)).toMatchObject({ id: legacyId, is_owner: 1 })
    expect(await login(env, { email: EMAIL, password: PASSWORD })).toMatchObject({ ok: true })
  })

  it('seals the token on the way through — the one moment the server ever sees it', async () => {
    const legacyId = await seedLegacyUser('legacy-token')
    const legacyUser: User = { id: legacyId, name: 'legacy', is_owner: 0, created_at: Date.now() }
    expect(await revealToken(env, legacyUser)).toBeNull()

    await claimAccount(env, { token: 'legacy-token', email: EMAIL, password: PASSWORD })

    expect(await revealToken(env, legacyUser)).toBe('legacy-token')
    const row = (await storedRow(legacyId))!
    expect(row.token_hash).toBe(await sha256Hex('legacy-token'))
  })

  it('refuses a second claim, a wrong token and a duplicate email', async () => {
    await seedLegacyUser('legacy-token')
    await seedLegacyUser('another-legacy-token')
    await claimAccount(env, { token: 'legacy-token', email: EMAIL, password: PASSWORD })

    expect(await claimAccount(env, { token: 'legacy-token', email: 'other@example.com', password: PASSWORD })).toEqual(
      { ok: false, error: 'token_has_account' },
    )
    expect(await claimAccount(env, { token: 'nope', email: 'other@example.com', password: PASSWORD })).toEqual({
      ok: false,
      error: 'invalid_token',
    })
    expect(await claimAccount(env, { token: 'another-legacy-token', email: EMAIL, password: PASSWORD })).toEqual({
      ok: false,
      error: 'email_taken',
    })
  })
})

describe('accountSummary', () => {
  it('reports what a settings page needs, and never a credential', async () => {
    const registered = await registerAlice()
    const legacyId = await seedLegacyUser('legacy-token')

    expect(await accountSummary(env, registered.user)).toEqual({ email: EMAIL, hasPassword: true })
    expect(
      await accountSummary(env, { id: legacyId, name: 'legacy', is_owner: 0, created_at: Date.now() }),
    ).toEqual({ email: null, hasPassword: false })
  })
})

// --------------------------------------------------------------------------

describe('/gate is untouched by any of this', () => {
  async function gate(app: string, token: string): Promise<{ status: number; body: GateDecision }> {
    const res = await handleGate(
      new Request(`https://yixi.test/gate?app=${app}&k=${encodeURIComponent(token)}`),
      env,
    )
    return { status: res.status, body: (await res.json()) as GateDecision }
  }

  it('gates a self-registered token exactly as it gated a hand-issued one', async () => {
    const res = await registerAlice()
    await seedApp(res.user.id, 'xhs')

    expect(await gate('unwatched', res.token)).toMatchObject({ status: 200, body: { action: 'pass' } })
    expect((await gate('xhs', res.token)).body.action).toBe('block')
    expect(await gate('xhs', 'not-the-token')).toMatchObject({ status: 401 })
  })

  it('still gates a token issued before accounts existed', async () => {
    const legacyId = await seedLegacyUser('legacy-token')
    await seedApp(legacyId, 'xhs')

    expect((await gate('xhs', 'legacy-token')).body.action).toBe('block')
  })

  it('verifies against the hash alone — the sealed copy is not part of the credential', async () => {
    const res = await registerAlice()
    await seedApp(res.user.id, 'xhs')

    // Destroy the readable copy: the account can no longer show the token, but
    // the gate must not notice. If this ever fails, the decrypt has crept into
    // the hot path, where the free plan's 10ms CPU budget cannot pay for it.
    await env.DB.prepare('UPDATE users SET token_cipher = NULL, token_iv = NULL WHERE id = ?1')
      .bind(res.user.id)
      .run()

    expect((await gate('xhs', res.token)).body.action).toBe('block')
    expect(await revealToken(env, res.user)).toBeNull()
  })

  it('does not accept a session cookie in place of the token', async () => {
    const res = await registerAlice()
    await seedApp(res.user.id, 'xhs')

    // /gate takes one credential and one only. A cookie reaching it would mean
    // the Shortcut path had quietly become browser-authenticated.
    expect(await gate('xhs', cookieValue(res.setCookie))).toMatchObject({ status: 401 })
  })
})
