import type { Env, User } from './types'
import { authenticate, issueCookie } from './auth'
import { handleGate, handleResolve } from './gate'
import { renderBreathe } from './ui/breathe'
import { renderMock } from './ui/mock'
import { renderUiMock } from './ui/uimock'
import { renderReview } from './ui/review'
import { renderProbe } from './ui/probe'
import { renderSetup } from './ui/setup'
import { handleLookup } from './ui/lookup'
import {
  handleAccount,
  handleClaim,
  handleLogin,
  handleRecover,
  handleRegister,
} from './ui/account'
import { handleSettings } from './ui/settings'
import { handleAdmin } from './api/admin'
import { renderLanding } from './ui/landing'
import { deleteExpiredWebSessions, deleteStaleSessions } from './db'
import { checkRate, pruneRateLimits } from './ratelimit'

/**
 * Route table. Only /gate and /resolve are machine-facing; everything else is a
 * server-rendered page with inlined CSS/JS (no external requests — these pages
 * must open instantly on a bad mobile connection).
 *
 * Auth has three shapes on purpose:
 *   /gate            — long-lived user token in the query string (the Shortcut
 *                      cannot set headers conveniently)
 *   /b, /resolve     — the sid alone; it is single-use, unguessable and already
 *                      bound to a user+app, so the long-lived token never
 *                      reaches the breathing page or its beacon
 *   everything else  — an opaque sessions_web row id in a cookie, seeded
 *                      once from ?k=; server-side so a password change can
 *                      revoke every live login
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      if (path === '/gate' && method === 'GET') return await handleGate(request, env)
      if (path === '/resolve' && method === 'POST') return await handleResolve(request, env)
      if (path === '/b' && method === 'GET') return await renderBreathe(request, env)
      if (path === '/mock' && method === 'GET') return renderMock(url)
      if (path === '/mock-ui' && method === 'GET') return renderUiMock(url)
      if (path === '/' && method === 'GET') return renderLanding()

      // Sign-up and sign-in must answer before authenticate(), or the only way
      // to get an account would be to already have one. Registration being open
      // to anyone, the POSTs are throttled per IP — GETs are just pages and are
      // not worth the D1 write.
      const openRoutes: Record<string, (r: Request, e: Env) => Promise<Response>> = {
        '/register': handleRegister,
        '/login': handleLogin,
        '/claim': handleClaim,
        '/recover': handleRecover,
      }
      const open = openRoutes[path]
      if (open) {
        if (method === 'POST') {
          const rate = await checkRate(env, path.slice(1), request)
          if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)
        }
        return await open(request, env)
      }

      // --- cookie-authenticated pages below ---
      const auth = await authenticate(request, env)
      if (!auth) return toLogin(url)
      const { user, seededFromToken } = auth

      let res: Response
      if (path === '/review' && method === 'GET') res = await renderReview(request, env, user)
      else if (path === '/probe' && method === 'GET') res = await renderProbe(env, user)
      else if (path === '/account') res = await handleAccount(request, env, user)
      else if (path === '/lookup') res = await handleLookup(request, env, user)
      else if (path === '/setup' && method === 'GET') res = await renderSetup(request, env, user)
      else if (path === '/settings') res = await handleSettings(request, env, user)
      else if (path.startsWith('/admin')) res = await handleAdmin(request, env, user)
      else return notFound()

      // First visit arrived with ?k=<token>; swap it for a cookie so the token
      // stops living in browser history and bookmarks.
      if (seededFromToken) {
        res = new Response(res.body, res)
        res.headers.append('Set-Cookie', await issueCookie(env, user))
      }
      return res
    } catch (err) {
      console.error('unhandled', err)
      return new Response('internal error', { status: 500 })
    }
  },

  /**
   * Nightly trim of the sessions breadcrumb table. `events` is never touched —
   * that history is the product. A session older than a week can only be a
   * breathing page nobody ever resolved.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Date.now()
    const removed = await deleteStaleSessions(env.DB, now - SESSION_RETENTION_MS)
    // Every `?k=` visit mints a login session; without this they only accumulate.
    const expired = await deleteExpiredWebSessions(env.DB, now)
    const rates = await pruneRateLimits(env, now - RATE_WINDOW_RETENTION_MS)
    console.log(`trimmed ${removed} sessions, ${expired} logins, ${rates} rate windows`)
  },
} satisfies ExportedHandler<Env>

const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** Comfortably past the longest window in LIMITS, so nothing live is dropped. */
const RATE_WINDOW_RETENTION_MS = 24 * 60 * 60 * 1000

function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response('慢一点。稍后再试。', {
    status: 429,
    headers: { 'retry-after': String(retryAfterSeconds), 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Signed-out visitors get the sign-in page, not a bare 401.
 *
 * A plain-text "unauthorized" is indistinguishable from a broken site — the
 * nav links to /setup and /review are the first thing anyone taps, and landing
 * on an unstyled error reads as "this thing is down", not "log in first".
 *
 * `next` carries the intended destination so signing in finishes the trip
 * rather than dumping everyone on the same landing page. Only a same-site path
 * is ever forwarded: an absolute URL here would turn the login page into an
 * open redirect that phishing can borrow.
 */
function toLogin(url: URL): Response {
  const next = url.pathname + url.search
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/review'
  return new Response(null, {
    status: 303,
    headers: { location: `/login?next=${encodeURIComponent(safe)}`, 'cache-control': 'no-store' },
  })
}

function notFound(): Response {
  return new Response('not found', { status: 404 })
}

export type { Env, User }
