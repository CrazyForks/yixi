import type { Env, User } from './types'
import { createWebSession, deleteWebSession, findUserByTokenHash, findUserByWebSession } from './db'
import { randomHex } from './crypto'

/**
 * Who is asking. Three ways in, all resolving to the same `User`:
 *
 *   ?k=<token>   the gate credential itself. The Shortcut cannot set headers
 *                conveniently, so /gate takes it in the query string, and a
 *                person holding it may also use it as a one-time way into the
 *                pages — it seeds a session and then drops out of the URL.
 *   cookie       a logged-in browser. The value is a `sessions_web` row id and
 *                nothing else: opaque, 128 bits, meaningless without the row.
 *   password     handled in account.ts, which mints the same cookie once the
 *                password checks out.
 *
 * The cookie used to be a stateless HMAC of `<userId>.<expiry>`, which was
 * cheaper — no read, no table — but could not be taken back. Changing a
 * password has to sign the old sessions out, and with a signed cookie the only
 * lever is rotating COOKIE_SECRET, which evicts everyone at once. A row per
 * session buys revocation for one indexed read per page view.
 */

export const COOKIE_NAME = 'yixi'

/**
 * Six months. Long on purpose: this thing is opened by a Shortcut on a phone,
 * and a login prompt at that moment is a login prompt between someone and the
 * app they are already reaching for. The session is revocable, which is what
 * makes a long life affordable.
 */
export const WEB_SESSION_TTL_SECONDS = 180 * 24 * 60 * 60

/** 128-bit, hex — the whole cookie value, per migration 0002. */
const SESSION_ID_BYTES = 16
const SESSION_ID_RE = /^[0-9a-f]{32}$/

export interface AuthResult {
  user: User
  /**
   * This request authenticated by ?k=, so the caller should attach a
   * Set-Cookie and let the token drop out of the URL from here on.
   */
  seededFromToken: boolean
  /** Which credential answered — for callers that must not accept a raw token. */
  via: 'token' | 'cookie'
  /** The session this request rode in on, or null when it came by ?k=. */
  sessionId: string | null
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
 *
 * Accounts changed nothing here. The encrypted copy of the token is never read
 * on this path: /gate is hit every time a phone opens a watched app, and a
 * decrypt (or worse, a password hash) in that path would blow the request
 * budget. The hash is the credential; the ciphertext is only ever shown back to
 * somebody who has already proved who they are.
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

/**
 * Opens a browser session and returns the Set-Cookie that carries it.
 *
 * The cookie holds the session id verbatim. There is nothing to sign: the id is
 * 128 bits of randomness that means nothing without its row, so a forged or
 * tampered value simply fails to match one. (A signature would only save the
 * lookup on junk cookies, which the shape check below already does for free.)
 */
export async function issueCookie(env: Env, user: User): Promise<string> {
  const id = randomHex(SESSION_ID_BYTES)
  const now = Date.now()
  await createWebSession(env.DB, {
    id,
    userId: user.id,
    createdAt: now,
    expiresAt: now + WEB_SESSION_TTL_SECONDS * 1000,
  })
  // SameSite=Lax, not Strict: on a phone these pages are opened by a top-level
  // navigation from somewhere else entirely — a Shortcut, a note, a message —
  // and Strict would drop the cookie on exactly that arrival, forcing the token
  // back into the URL that this cookie exists to keep it out of.
  return `${COOKIE_NAME}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${WEB_SESSION_TTL_SECONDS}`
}

/**
 * Drops the session row and the cookie with it. The row goes first: a cookie
 * the browser refused to clear must not still open anything.
 */
export async function revokeCookie(env: Env, sessionId: string | null): Promise<string> {
  if (sessionId && SESSION_ID_RE.test(sessionId)) await deleteWebSession(env.DB, sessionId)
  return clearCookie()
}

/** Max-Age=0 with the same attributes, which is how a browser is told to forget one. */
export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

export function sessionIdFrom(request: Request): string | null {
  const raw = readCookie(request, COOKIE_NAME)
  // Anything that is not a session id — junk, a truncated value, or one of the
  // old signed `<id>.<expiry>.<sig>` cookies still sitting in a phone — is
  // rejected here rather than in D1. Those old cookies are dead by design: a
  // stateless credential cannot be revoked, so honouring them would reopen the
  // hole this table was added to close.
  return raw && SESSION_ID_RE.test(raw) ? raw : null
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
    return user ? { user, seededFromToken: true, via: 'token', sessionId: null } : null
  }

  const sessionId = sessionIdFrom(request)
  if (!sessionId) return null
  const user = await findUserByWebSession(env.DB, sessionId, Date.now())
  return user ? { user, seededFromToken: false, via: 'cookie', sessionId } : null
}
