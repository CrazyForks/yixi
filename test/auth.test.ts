import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { COOKIE_NAME, authenticate, issueCookie, sha256Hex, timingSafeEqual, userFromToken } from '../src/auth'
import type { Env, User } from '../src/types'

const TOKEN = 'alice-token'
const OTHER_TOKEN = 'bob-token'

async function reset(): Promise<void> {
  await env.DB.prepare('DELETE FROM users').run()
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

/** Independently signs a payload the way auth.ts does, to forge test cookies. */
async function sign(payload: string, secret = 'test-cookie-secret'): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
  let binary = ''
  for (const b of sig) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function forgedCookie(payload: string, secret?: string): Promise<string> {
  return `${COOKIE_NAME}=${payload}.${await sign(payload, secret)}`
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

    expect(user).toEqual({ id: userId, name: 'alice', is_owner: 1, created_at: expect.any(Number) })
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

    expect(auth?.seededFromToken).toBe(true)
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
    const user: User = { id: 1, name: 'alice', is_owner: 0, created_at: Date.now() }

    const setCookie = await issueCookie(env, user)

    expect(setCookie.startsWith(`${COOKIE_NAME}=`)).toBe(true)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toMatch(/Max-Age=\d+/)
  })

  it('carries no token — only the user id, an expiry and a signature', async () => {
    const userId = await seedUser(TOKEN)
    const user = (await userFromToken(env, TOKEN))!

    const value = cookieValue(await issueCookie(env, user))

    expect(value).not.toContain(TOKEN)
    expect(value).not.toContain(await sha256Hex(TOKEN))
    expect(value.split('.')[0]).toBe(String(userId))
  })

  it('refuses to sign with an unconfigured secret rather than using a known one', async () => {
    const user: User = { id: 1, name: 'alice', is_owner: 0, created_at: Date.now() }
    const brokenEnv = { DB: env.DB, COOKIE_SECRET: '' } as Env

    await expect(issueCookie(brokenEnv, user)).rejects.toThrow(/COOKIE_SECRET/)
  })
})

describe('authenticate — cookie entry', () => {
  it('accepts the cookie it just issued, with no seeding this time', async () => {
    const userId = await seedUser(TOKEN)
    const user = (await userFromToken(env, TOKEN))!
    const cookie = cookieValue(await issueCookie(env, user))

    const auth = await authenticate(request('/review', `${COOKIE_NAME}=${cookie}`), env)

    expect(auth?.seededFromToken).toBe(false)
    expect(auth?.user.id).toBe(userId)
  })

  it('finds its cookie among others', async () => {
    const userId = await seedUser(TOKEN)
    const user = (await userFromToken(env, TOKEN))!
    const cookie = cookieValue(await issueCookie(env, user))

    const auth = await authenticate(request('/review', `a=1; ${COOKIE_NAME}=${cookie}; b=2`), env)

    expect(auth?.user.id).toBe(userId)
  })

  it('rejects a tampered user id — the signature covers it', async () => {
    const alice = await seedUser(TOKEN, 'alice')
    const bob = await seedUser(OTHER_TOKEN, 'bob')
    const cookie = cookieValue(await issueCookie(env, (await userFromToken(env, TOKEN))!))
    const [, exp, sig] = cookie.split('.')

    const forged = `${COOKIE_NAME}=${bob}.${exp}.${sig}`

    expect(alice).not.toBe(bob)
    expect(await authenticate(request('/review', forged), env)).toBeNull()
  })

  it('rejects a mangled signature and a structurally broken value', async () => {
    await seedUser(TOKEN)
    const cookie = cookieValue(await issueCookie(env, (await userFromToken(env, TOKEN))!))
    const mangled = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A')

    expect(await authenticate(request('/review', `${COOKIE_NAME}=${mangled}`), env)).toBeNull()
    expect(await authenticate(request('/review', `${COOKIE_NAME}=garbage`), env)).toBeNull()
    expect(await authenticate(request('/review', `${COOKIE_NAME}=`), env)).toBeNull()
  })

  it('rejects a cookie signed with a different secret', async () => {
    const userId = await seedUser(TOKEN)
    const payload = `${userId}.${Date.now() + 60_000}`

    const forged = await forgedCookie(payload, 'not-the-cookie-secret')

    expect(await authenticate(request('/review', forged), env)).toBeNull()
    // Control: the same payload under the real secret does authenticate, so the
    // rejection above is about the key and not about the payload shape.
    expect(await authenticate(request('/review', await forgedCookie(payload)), env)).not.toBeNull()
  })

  it('rejects an expired cookie even though the signature is valid', async () => {
    const userId = await seedUser(TOKEN)

    const expired = await forgedCookie(`${userId}.${Date.now() - 1000}`)

    expect(await authenticate(request('/review', expired), env)).toBeNull()
  })

  it('rejects a validly signed cookie for a user that no longer exists', async () => {
    const userId = await seedUser(TOKEN)
    const cookie = await forgedCookie(`${userId}.${Date.now() + 60_000}`)
    await env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(userId).run()

    expect(await authenticate(request('/review', cookie), env)).toBeNull()
  })
})
