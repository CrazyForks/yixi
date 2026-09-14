export interface Env {
  DB: D1Database
  /**
   * Legacy. Browser sessions are rows in `sessions_web` now and the cookie
   * carries only an opaque id, so nothing is signed with this any more. Kept
   * so existing deployments do not have to drop a secret to upgrade.
   */
  COOKIE_SECRET: string
  /**
   * AES-GCM key the gate tokens are sealed under, so a logged-in holder can
   * read their own key back. `wrangler secret put TOKEN_KEY`.
   *
   * Never reaches D1. Rotating it does not lock anybody out — /gate verifies
   * against `token_hash` and never touches the ciphertext — it only makes the
   * old sealed copies unreadable, so people would have to be re-issued a token
   * to see one again.
   */
  TOKEN_KEY: string
  /**
   * Turnstile, guarding /register only. Both optional and both required
   * together: with either one missing the challenge is disabled and sign-up
   * works exactly as it did before it existed, which is what lets `npm run dev`
   * and a fresh self-host deploy work without a Cloudflare widget. See the
   * header of src/turnstile.ts for the fail-open reasoning and its price.
   *
   * TURNSTILE_SITE_KEY is public — it is rendered into the page — so it can be
   * a plain `[vars]` entry. TURNSTILE_SECRET must be a secret.
   */
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET?: string
}

export interface User {
  id: number
  name: string
  is_owner: number
  created_at: number
  /**
   * The language this user has chosen ('zh' | 'en'), or NULL/unset if they
   * never have. Optional — not just nullable — so every existing `User`
   * literal in the test suite keeps compiling unedited; see
   * src/i18n/index.ts's `localeOf`, which treats a missing property exactly
   * like a NULL one.
   */
  locale?: string | null
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
 * A logged-in browser. Distinct from `Session` above, which is one
 * interception; these two never mix and are deliberately named apart.
 *
 * The id is the entire cookie value, so a row here is the only thing that makes
 * a cookie work: deleting it signs that browser out, and deleting a user's rows
 * signs them out everywhere. That is the whole reason this table exists.
 */
export interface WebSession {
  id: string
  user_id: number
  created_at: number
  expires_at: number
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

// --- goals（/today、/goals）--------------------------------------------------

export interface Goal {
  id: number
  user_id: number
  title: string
  /** 触发时机，「早饭后」「地铁上」，纯展示。 */
  cue: string
  /** 跳转目标：自定义 scheme 或 https 网址；'' 表示没绑。 */
  target: string
  /** 「B 站」；按钮显示「去 B 站」，空则「去做」。 */
  target_label: string
  position: number
  /** YYYY-MM-DD；NULL = 长期。 */
  until: string | null
  created_at: number
  archived_at: number | null
}

export interface GoalTask {
  id: number
  goal_id: number
  user_id: number
  title: string
  /** 这条子任务自己的跳转目标；'' 表示跟着所属目标的跳转走。 */
  target: string
  /** 「B 站」；行内按钮显示「去 B 站」，空则「去做」。 */
  target_label: string
  position: number
  created_at: number
  /**
   * 一次性待办年代的完成时间戳。0007 之后不再读写：每天的勾选记在
   * goal_task_checkins 里。列还在，代码里的这个字段会在子任务改造收尾时删掉。
   */
  done_at: number | null
}

/**
 * 一天的快照，由 00:00（Asia/Shanghai）的 cron 写入一次后不再改：那天
 * /today 展示了几个目标（shown）、打了几个卡（done）、划掉几条子任务
 * （tasks_done）。没跑到的日子在 goal_days 里就是空位，不是这个类型的值。
 */
export interface GoalDay {
  user_id: number
  date: string
  shown: number
  done: number
  tasks_done: number
  ts: number
}

/** /today 只展示排前面的这几个；其余折叠。产品立场，不是技术限制。 */
export const TODAY_GOAL_LIMIT = 3
/** 到期目标「续一期」的长度。 */
export const GOAL_EXTEND_DAYS = 28
