import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { COOKIE_NAME, authenticate, clearCookie, issueCookie, revokeCookie, sha256Hex, timingSafeEqual, userFromToken } from '../src/auth'
import type { User } from '../src/types'

const TOKEN = 'alice-token'
const OTHER_TOKEN = 'bob-token'

async function reset(): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM sessions_web'), env.DB.prepare('DELETE FROM users')])
}

async function seedUser(token: string, name = 'alice', isOwner = 0): Promise<number> {
  const res = await env.DB.prepare('INSERT INTO users (name, token_hash, is_owner, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(name, await sha256Hex(token), isOwner, Date.now())
    .run()
  return Number(res.meta.last_row_id)
}

function request(path: string, cookie?: string): Request {
  return new Request(`https://yixi.test${path}`, cookie ? { headers: { Cookie: cookie } } : undefined)
}

/** Strips `name=` and the attributes off a Set-Cookie value. */
function cookieValue(setCookie: string): string {
  const first = setCookie.split(';')[0] ?? ''
  return first.slice(first.indexOf('=') + 1)
}

beforeEach(reset)

describe('timingSafeEqual', () => {
  it('matches equal strings and rejects every kind of difference', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('', '')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('abc', '')).toBe(false)
  })
})

describe('sha256Hex', () => {
  it('produces the standard lowercase hex digest', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('is what the users table stores — the plaintext token is never written', async () => {
    const userId = await seedUser(TOKEN)
    const row = await env.DB.prepare('SELECT token_hash FROM users WHERE id = ?1')
      .bind(userId)
      .first<{ token_hash: string }>()

    expect(row?.token_hash).toBe(await sha256Hex(TOKEN))
    expect(row?.token_hash).not.toContain(TOKEN)
  })
})

describe('userFromToken', () => {
  it('resolves a valid token to its user, without leaking the hash', async () => {
    const userId = await seedUser(TOKEN, 'alice', 1)

    const user = await userFromToken(env, TOKEN)

    expect(user).toEqual({
      id: userId,
      name: 'alice',
      is_owner: 1,
      created_at: expect.any(Number),
      locale: null,
    })
    expect(user).not.toHaveProperty('token_hash')
  })

  it('returns null for a wrong, empty or unknown token', async () => {
    await seedUser(TOKEN)

    expect(await userFromToken(env, 'wrong')).toBeNull()
    expect(await userFromToken(env, '')).toBeNull()
    expect(await userFromToken(env, `${TOKEN} `)).toBeNull()
  })

  it('keeps two users apart', async () => {
    const alice = await seedUser(TOKEN, 'alice')
    const bob = await seedUser(OTHER_TOKEN, 'bob')

    expect((await userFromToken(env, TOKEN))?.id).toBe(alice)
    expect((await userFromToken(env, OTHER_TOKEN))?.id).toBe(bob)
  })
})

describe('authenticate — ?k= entry', () => {
  it('accepts a valid token and reports that a cookie should be seeded', async () => {
    const userId = await seedUser(TOKEN)

    const auth = await authenticate(request(`/review?k=${TOKEN}`), env)

    expect(auth).toMatchObject({ seededFromToken: true, via: 'token', sessionId: null })
    expect(auth?.user.id).toBe(userId)
  })

  it('rejects a bad token instead of falling back to a cookie', async () => {
    const userId = await seedUser(TOKEN)
    const setCookie = await issueCookie(env, { id: userId, name: 'alice', is_owner: 0, created_at: Date.now() })

    // A wrong ?k= on a phone that already holds a valid cookie must fail —
    // otherwise a mistyped or revoked link silently shows the resident user's log.
    const auth = await authenticate(request('/review?k=wrong', `${COOKIE_NAME}=${cookieValue(setCookie)}`), env)

    expect(auth).toBeNull()
  })

  it('rejects when there is no credential at all', async () => {
    await seedUser(TOKEN)
    expect(await authenticate(request('/review'), env)).toBeNull()
  })
})

describe('issueCookie', () => {
  it('is HttpOnly, Secure, SameSite=Lax and site-wide', async () => {
    const userId = await seedUser(TOKEN)
    const user: User = { id: userId, name: 'alice', is_owner: 0, created_at: Date.now() }

    const setCookie = await issueCookie(env, user)

    expect(setCookie.startsWith(`${COOKIE_NAME}=`)).toBe(true)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toMatch(/Max-Age=\d+/)
  })

  it('carries a 128-bit opaque session id and nothing else', async () => {
    await seedUser(TOKEN)
    const user = (await userFromToken(env, TOKEN))!

    const value = cookieValue(await issueCookie(env, user))

    // Nothing but randomness: no token, and no `.`-separated payload the way
    // the old signed cookie carried a user id and an expiry in the clear. The
    // value means nothing without its row, which is what makes it revocable.
    expect(value).toMatch(/^[0-9a-f]{32}$/)
    expect(value).not.toContain(TOKEN)
    expect(value).not.toContain(await sha256Hex(TOKEN))
    expect(value).not.toContain('.')
  })

  it('records the session server-side, with an expiry the browser does not control', async () => {
    const userId = await seedUser(TOKEN)
    const user = (await userFromToken(env, TOKEN))!

    const value = cookieValue(await issueCookie(env, user))

    const row = await env.DB.prepare('SELECT user_id, created_at, expires_at FROM sessions_web WHERE id = ?1')
      .bind(value)
      .first<{ user_id: number; created_at: number; expires_at: number }>()
    expect(row?.user_id).toBe(userId)
    expect(row!.expires_at).toBeGreaterThan(Date.now())
  })

  it('mints a fresh session per call, so one browser signing out does not sign out the rest', async () => {
    await seedUser(TOKEN)
    const user = (await userFromToken(env, TOKEN))!

    const first = cookieValue(await issueCookie(env, user))
    const second = cookieValue(await issueCookie(env, user))

    expect(first).not.toBe(second)
  })
})

describe('authenticate — cookie entry', () => {
  it('accepts the cookie it just issued, with no seeding this time', async () => {
    const userId = await seedUser(TOKEN)
    const user = (await userFromToken(env, TOKEN))!
    const cookie = cookieValue(await issueCookie(env, user))

    const auth = await authenticate(request('/review', `${COOKIE_NAME}=${cookie}`), env)

    expect(auth).toMatchObject({ seededFromToken: false, via: 'cookie', sessionId: cookie })
    expect(auth?.user.id).toBe(userId)
  })

  it('finds its cookie among others', async () => {
    const userId = await seedUser(TOKEN)
    const user = (await userFromToken(env, TOKEN))!
    const cookie = cookieValue(await issueCookie(env, user))

    const auth = await authenticate(request('/review', `a=1; ${COOKIE_NAME}=${cookie}; b=2`), env)

    expect(auth?.user.id).toBe(userId)
  })

  it('rejects a mangled session id — one flipped character is a different session', async () => {
    await seedUser(TOKEN)
    const cookie = cookieValue(await issueCookie(env, (await userFromToken(env, TOKEN))!))
    const mangled = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a')

    expect(await authenticate(request('/review', `${COOKIE_NAME}=${mangled}`), env)).toBeNull()
    expect(await authenticate(request('/review', `${COOKIE_NAME}=garbage`), env)).toBeNull()
    expect(await authenticate(request('/review', `${COOKIE_NAME}=`), env)).toBeNull()
  })

  it('rejects the old stateless cookie shape outright', async () => {
    const userId = await seedUser(TOKEN)

    // `<userId>.<expiry>.<hmac>` used to be the whole credential. It cannot be
    // revoked, which is exactly why sessions moved into a table, so a leftover
    // one in somebody's phone must simply stop working.
    const legacy = `${COOKIE_NAME}=${userId}.${Date.now() + 60_000}.c2lnbmF0dXJl`

    expect(await authenticate(request('/review', legacy), env)).toBeNull()
  })

  it('rejects an expired session even though the cookie is intact', async () => {
    await seedUser(TOKEN)
    const cookie = cookieValue(await issueCookie(env, (await userFromToken(env, TOKEN))!))

    await env.DB.prepare('UPDATE sessions_web SET expires_at = ?1 WHERE id = ?2').bind(Date.now() - 1, cookie).run()

    expect(await authenticate(request('/review', `${COOKIE_NAME}=${cookie}`), env)).toBeNull()
  })

  it('rejects a revoked session — this is what the table bought', async () => {
    await seedUser(TOKEN)
    const cookie = cookieValue(await issueCookie(env, (await userFromToken(env, TOKEN))!))
    expect(await authenticate(request('/review', `${COOKIE_NAME}=${cookie}`), env)).not.toBeNull()

    await revokeCookie(env, cookie)

    expect(await authenticate(request('/review', `${COOKIE_NAME}=${cookie}`), env)).toBeNull()
  })

  it('rejects a live session whose user no longer exists', async () => {
    const userId = await seedUser(TOKEN)
    const cookie = cookieValue(await issueCookie(env, (await userFromToken(env, TOKEN))!))
    await env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(userId).run()

    expect(await authenticate(request('/review', `${COOKIE_NAME}=${cookie}`), env)).toBeNull()
  })
})

describe('clearCookie', () => {
  it('expires the cookie with the attributes it was set with, or the browser keeps it', async () => {
    const cleared = clearCookie()

    expect(cleared.startsWith(`${COOKIE_NAME}=;`)).toBe(true)
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('Path=/')
    expect(cleared).toContain('HttpOnly')
    expect(cleared).toContain('Secure')
  })

  it('tolerates a caller with no session id — signing out twice is not an error', async () => {
    expect(await revokeCookie(env, null)).toContain('Max-Age=0')
    expect(await revokeCookie(env, 'not-a-session-id')).toContain('Max-Age=0')
  })
})
