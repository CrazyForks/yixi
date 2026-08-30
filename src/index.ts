import type { Env, User } from './types'
import { authenticate, issueCookie } from './auth'
import { handleGate, handleResolve } from './gate'
import { renderBreathe } from './ui/breathe'
import { renderMock } from './ui/mock'
import { renderReview } from './ui/review'
import { renderProbe } from './ui/probe'
import { handleSettings } from './ui/settings'
import { handleAdmin } from './api/admin'
import { renderLanding } from './ui/landing'
import { deleteStaleSessions } from './db'

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
 *   everything else  — HMAC cookie, seeded once from ?k=
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
      if (path === '/' && method === 'GET') return renderLanding()

      // --- cookie-authenticated pages below ---
      const auth = await authenticate(request, env)
      if (!auth) return unauthorized()
      const { user, seededFromToken } = auth

      let res: Response
      if (path === '/review' && method === 'GET') res = await renderReview(request, env, user)
      else if (path === '/probe' && method === 'GET') res = await renderProbe(env, user)
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
    const cutoff = Date.now() - SESSION_RETENTION_MS
    const removed = await deleteStaleSessions(env.DB, cutoff)
    console.log(`trimmed ${removed} stale sessions`)
  },
} satisfies ExportedHandler<Env>

const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function unauthorized(): Response {
  return new Response('unauthorized', { status: 401 })
}

function notFound(): Response {
  return new Response('not found', { status: 404 })
}

export type { Env, User }
