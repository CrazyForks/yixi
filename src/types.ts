export interface Env {
  DB: D1Database
  /** HMAC key for the /review session cookie. `wrangler secret put COOKIE_SECRET`. */
  COOKIE_SECRET: string
}

export interface User {
  id: number
  name: string
  is_owner: number
  created_at: number
}

export interface UserApp {
  user_id: number
  app: string
  label: string
  scheme: string
  wait_seconds: number
  grace_seconds: number
  enabled: number
}

export interface Session {
  sid: string
  user_id: number
  app: string
  created_at: number
  resolved_at: number | null
}

/**
 * attempt     — a genuine impulse: the automation fired outside any grace window
 * grace_pass  — the automation re-firing while we hand control back; machine noise
 * proceeded   — user pushed through the wait and opened the app
 * abandoned   — user backed out
 *
 * Statistics use `attempt` as the sole denominator. Counting grace_pass would
 * make every ratio meaningless.
 */
export type EventKind = 'attempt' | 'grace_pass' | 'proceeded' | 'abandoned'

export type GateDecision =
  | { action: 'pass' }
  | { action: 'block'; url: string }

/** Sessions older than this are dead links; /b refuses to render them. */
export const SESSION_TTL_MS = 10 * 60 * 1000

export const DEFAULT_WAIT_SECONDS = 10
export const DEFAULT_GRACE_SECONDS = 90
