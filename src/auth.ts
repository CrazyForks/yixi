import type { Env, User } from './types'
import { findUserByTokenHash, getUserById } from './db'

/**
 * A token IS an identity here — no registration, no password, no email. Two
 * ways in, both resolving to the same `User`:
 *
 *   ?k=<token>   the long-lived credential, handed out by the owner offline
 *   cookie       an HMAC-signed, stateless echo of a successful ?k= visit
 *
 * The cookie exists purely for privacy: /review is a minute-by-minute log of
 * someone's worst impulses, and a URL that carries the token to it would sit
 * forever in history, bookmarks and screenshots.
 */

export const COOKIE_NAME = 'yixi'
const COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

export interface AuthResult {
  user: User
  /**
   * This request authenticated by ?k=, so the caller should attach a
   * Set-Cookie and let the token drop out of the URL from here on.
   */
  seededFromToken: boolean
}

/**
 * Compares without an early exit on either a mismatching character or a length
 * mismatch, so response timing does not report how many leading bytes of a
 * guess were right.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length === b.length ? 0 : 1
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0
    const cb = i < b.length ? b.charCodeAt(i) : 0
    diff |= ca ^ cb
  }
  return diff === 0
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Resolves a raw token to its user, or null. The DB lookup is an indexed
 * equality on the *hash*, which leaks nothing an attacker can steer (they would
 * need a preimage to aim it), but the confirming comparison is still done in
 * constant time here so that no future refactor of that query can turn into a
 * character-by-character oracle on the credential itself.
 */
export async function userFromToken(env: Env, token: string): Promise<User | null> {
  if (!token) return null
  const hash = await sha256Hex(token)
  const row = await findUserByTokenHash(env.DB, hash)
  if (!row) return null
  if (!timingSafeEqual(row.token_hash, hash)) return null
  return { id: row.id, name: row.name, is_owner: row.is_owner, created_at: row.created_at }
}

// --- cookie ---------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sign(env: Env, payload: string): Promise<string> {
  // An unset COOKIE_SECRET is `undefined` at runtime despite the Env type, and
  // TextEncoder would happily encode it as the literal string "undefined" —
  // a fixed, publicly known signing key. Fail loudly instead.
  if (!env.COOKIE_SECRET) throw new Error('COOKIE_SECRET is not configured')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.COOKIE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return base64url(new Uint8Array(sig))
}

/**
 * `<userId>.<expiryMs>.<hmac>` — stateless, so there is no session table to
 * grow and no extra read on every page. The expiry is inside the signed payload
 * rather than trusted from Max-Age, which the browser controls.
 */
export async function issueCookie(env: Env, user: User): Promise<string> {
  const payload = `${user.id}.${Date.now() + COOKIE_MAX_AGE_SECONDS * 1000}`
  const value = `${payload}.${await sign(env, payload)}`
  // SameSite=Lax, not Strict: on a phone these pages are opened by a top-level
  // navigation from somewhere else entirely — a Shortcut, a note, a message —
  // and Strict would drop the cookie on exactly that arrival, forcing the token
  // back into the URL that this cookie exists to keep it out of.
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}`
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

async function userFromCookie(request: Request, env: Env): Promise<User | null> {
  const raw = readCookie(request, COOKIE_NAME)
  if (!raw || !env.COOKIE_SECRET) return null

  const cut = raw.lastIndexOf('.')
  if (cut <= 0) return null
  const payload = raw.slice(0, cut)
  const signature = raw.slice(cut + 1)
  if (!timingSafeEqual(signature, await sign(env, payload))) return null

  const [idPart, expPart] = payload.split('.')
  if (idPart === undefined || expPart === undefined) return null
  const id = Number(idPart)
  const expiresAt = Number(expPart)
  if (!Number.isInteger(id) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null

  // A signature only proves the id was ours once; the user may since have been
  // deleted, so the row still has to exist.
  return await getUserById(env.DB, id)
}

/**
 * Token first, cookie second. A ?k= that does not resolve fails the whole
 * request rather than falling back to the cookie: someone pasting a wrong or
 * revoked token should be told so, not silently shown the previous user's log
 * on a shared phone.
 */
export async function authenticate(request: Request, env: Env): Promise<AuthResult | null> {
  const token = new URL(request.url).searchParams.get('k')
  if (token !== null) {
    const user = await userFromToken(env, token)
    return user ? { user, seededFromToken: true } : null
  }
  const user = await userFromCookie(request, env)
  return user ? { user, seededFromToken: false } : null
}
