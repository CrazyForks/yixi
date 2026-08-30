// Aggregation layer for /review. Pure data — no HTML lives here (src/ui/review.ts
// owns rendering), so every number on the page is independently testable.
//
// The one rule that makes or breaks this module: `grace_pass` is machine noise.
// It is the "打开 App 时" automation re-firing while we hand control back to the
// target app, not a human impulse. Every query below therefore starts from
// `kind = 'attempt'` rows only, and `attempt` is the sole denominator of every
// ratio. Counting grace_pass anywhere would silently deflate the abandon rate.
//
// Second rule, less obvious: a session's outcome is attributed to the day of its
// ATTEMPT, not the day the user tapped a button. Someone intercepted at 23:59:50
// who taps 「算了」at 00:00:05 belongs to the day the impulse happened. Counting
// per-kind per-day instead would let `attempt − proceeded − abandoned` go
// negative across midnight — see the LEFT JOIN in getDailyStats().
//
// Third rule, easy to trip over: `grace_pass` rows carry `sid = ''` — a sentinel,
// because nothing was intercepted so no session exists behind them (see
// NO_SESSION in src/gate.ts; events.sid is NOT NULL). Every grace_pass a user
// ever produced therefore shares that one sid value. Nothing here joins on it
// (both sides of the self-join below are kind-filtered), and the join condition
// still carries an explicit `a.sid <> ''` so a future kind change cannot
// silently fan one attempt out across a pile of noise rows.

import { countEventsByKind } from './db'
import type { Env, EventKind } from './types'

/** Events carry a pre-computed local day; this is the zone that produced it. */
export const TIME_ZONE = 'Asia/Shanghai'

/** Trend window on the review page: today plus the six days before it. */
export const WEEK_DAYS = 7

/** Overview + per-app ranking window. */
export const MONTH_DAYS = 30

// Interpolated into the SQL below rather than written as bare string literals,
// so a rename of an EventKind fails the typecheck here instead of silently
// producing zeroes at runtime. Values are compile-time constants — nothing
// user-supplied ever reaches a query string.
const KIND = {
  attempt: 'attempt',
  gracePass: 'grace_pass',
  proceeded: 'proceeded',
  abandoned: 'abandoned',
} as const satisfies Record<string, EventKind>

/**
 * One bucket of interceptions. `attempts` is always the denominator.
 *
 * `undecided` is the honest residual: the breathing page opened, and the user
 * swiped away without choosing. Those sessions did NOT enter the app, but they
 * are not a deliberate 「算了」either, so they are never folded into `abandoned`
 * — the review page shows all three numbers side by side.
 */
export interface Counts {
  attempts: number
  proceeded: number
  abandoned: number
  undecided: number
  /** abandoned / attempts. `null` (never NaN) when there were no attempts. */
  abandonRate: number | null
}

export interface DayStat extends Counts {
  /** Asia/Shanghai local day, YYYY-MM-DD. */
  date: string
}

export interface AppStat extends Counts {
  /** Short key as stored on the event, e.g. "xhs". */
  app: string
  /** Display name from user_apps; falls back to the key if the app was removed. */
  label: string
}

export interface ReviewStats {
  /** Today in Asia/Shanghai, YYYY-MM-DD. */
  today: string
  todayCounts: DayStat
  /** Exactly WEEK_DAYS rows, oldest → newest, zero-filled for quiet days. */
  week: DayStat[]
  weekTotals: Counts
  /** MONTH_DAYS window, most-interrupting app first. */
  apps: AppStat[]
  monthTotals: Counts
  /** Days inside the month window with at least one attempt. */
  monthActiveDays: number
  /**
   * grace_pass count in the month window. Excluded from every figure above and
   * shown on the page purely as a footnote — the exclusion should be visible,
   * not invisible.
   */
  monthGracePasses: number
  /** Earliest attempt ever, or null for a brand-new user (drives the empty state). */
  firstDate: string | null
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The Asia/Shanghai calendar day for an epoch-ms instant, as YYYY-MM-DD. */
export function localDate(ts: number = Date.now()): string {
  return DAY_FORMAT.format(new Date(ts))
}

/**
 * Calendar-day arithmetic on a YYYY-MM-DD string. Anchoring the string at UTC
 * midnight and adding whole days is exact here because Asia/Shanghai has no DST
 * — no offset ever shifts under us.
 */
export function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(t)) throw new Error(`shiftDate: not a YYYY-MM-DD date: ${date}`)
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}

/** `days` consecutive dates ending at (and including) `endDate`, ascending. */
export function dateRange(endDate: string, days: number): string[] {
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(shiftDate(endDate, -i))
  return out
}

export function emptyCounts(): Counts {
  return { attempts: 0, proceeded: 0, abandoned: 0, undecided: 0, abandonRate: null }
}

export function emptyDay(date: string): DayStat {
  return { date, ...emptyCounts() }
}

/**
 * Builds a Counts from raw tallies. `undecided` is clamped at zero: with
 * session-anchored attribution it cannot go negative, but a resolve written
 * against an attempt that was never recorded should degrade to 0 rather than
 * render "-1 次没做选择" on the page.
 */
function counts(attempts: number, proceeded: number, abandoned: number): Counts {
  return {
    attempts,
    proceeded,
    abandoned,
    undecided: Math.max(0, attempts - proceeded - abandoned),
    abandonRate: attempts > 0 ? abandoned / attempts : null,
  }
}

/** Adds up any set of buckets, recomputing the rate from the summed totals. */
export function sumCounts(rows: readonly Counts[]): Counts {
  let attempts = 0
  let proceeded = 0
  let abandoned = 0
  for (const r of rows) {
    attempts += r.attempts
    proceeded += r.proceeded
    abandoned += r.abandoned
  }
  return counts(attempts, proceeded, abandoned)
}

// Each session resolves at most once (/resolve is idempotent on an unresolved
// sid), but a duplicate row would fan out the LEFT JOIN and inflate `attempts`,
// so collapse to one resolution per sid first. SQLite guarantees that bare
// columns selected alongside MIN() come from the row that produced the minimum,
// which makes this "the first decision wins".
//
// `sid <> ''` excludes the grace_pass sentinel. The kind filter already does,
// but this row set is joined against attempts by sid, and every grace_pass in
// the table shares that one value — an accidental match here would multiply a
// day's attempts by the size of the noise pile, so it is guarded twice.
const FIRST_RESOLUTION = `
  SELECT sid, kind, MIN(ts) AS first_ts
  FROM events
  WHERE user_id = ?1 AND sid <> '' AND kind IN ('${KIND.proceeded}', '${KIND.abandoned}')
  GROUP BY sid
`

interface DailyRow {
  date: string
  attempts: number
  proceeded: number
  abandoned: number
}

/**
 * Per-day buckets for the inclusive [startDate, endDate] window, ascending.
 * Sparse: days with no attempts are absent (callers zero-fill via dateRange).
 */
export async function getDailyStats(
  db: D1Database,
  userId: number,
  startDate: string,
  endDate: string,
): Promise<DayStat[]> {
  const res = await db
    .prepare(
      `SELECT a.date AS date,
              COUNT(*) AS attempts,
              SUM(CASE WHEN r.kind = '${KIND.proceeded}' THEN 1 ELSE 0 END) AS proceeded,
              SUM(CASE WHEN r.kind = '${KIND.abandoned}' THEN 1 ELSE 0 END) AS abandoned
       FROM events a
       LEFT JOIN (${FIRST_RESOLUTION}) r ON r.sid = a.sid AND a.sid <> ''
       WHERE a.user_id = ?1 AND a.kind = '${KIND.attempt}'
         AND a.date >= ?2 AND a.date <= ?3
       GROUP BY a.date
       ORDER BY a.date`,
    )
    .bind(userId, startDate, endDate)
    .all<DailyRow>()

  return res.results.map(r => ({
    date: r.date,
    ...counts(Number(r.attempts) || 0, Number(r.proceeded) || 0, Number(r.abandoned) || 0),
  }))
}

interface AppRow {
  app: string
  label: string | null
  attempts: number
  proceeded: number
  abandoned: number
}

/**
 * Which app costs you the most, by attempts, each with its own abandon rate.
 * Apps deleted from user_apps still show up (under their raw key) — the history
 * happened, and hiding it would quietly shrink the totals.
 */
export async function getAppStats(
  db: D1Database,
  userId: number,
  startDate: string,
  endDate: string,
): Promise<AppStat[]> {
  const res = await db
    .prepare(
      `SELECT a.app AS app,
              ua.label AS label,
              COUNT(*) AS attempts,
              SUM(CASE WHEN r.kind = '${KIND.proceeded}' THEN 1 ELSE 0 END) AS proceeded,
              SUM(CASE WHEN r.kind = '${KIND.abandoned}' THEN 1 ELSE 0 END) AS abandoned
       FROM events a
       LEFT JOIN (${FIRST_RESOLUTION}) r ON r.sid = a.sid AND a.sid <> ''
       LEFT JOIN user_apps ua ON ua.user_id = a.user_id AND ua.app = a.app
       WHERE a.user_id = ?1 AND a.kind = '${KIND.attempt}'
         AND a.date >= ?2 AND a.date <= ?3
       GROUP BY a.app, ua.label
       ORDER BY attempts DESC, a.app ASC`,
    )
    .bind(userId, startDate, endDate)
    .all<AppRow>()

  return res.results.map(r => ({
    app: r.app,
    label: r.label ?? r.app,
    ...counts(Number(r.attempts) || 0, Number(r.proceeded) || 0, Number(r.abandoned) || 0),
  }))
}

/**
 * grace_pass rows in the window. Reported on its own, never mixed into a ratio
 * — this number exists so the reader can see what was thrown away.
 */
export async function countGracePasses(
  db: D1Database,
  userId: number,
  startDate: string,
  endDate: string,
): Promise<number> {
  const byKind = await countEventsByKind(db, userId, startDate, endDate)
  return byKind[KIND.gracePass] ?? 0
}

/** Earliest recorded attempt, or null if this user has never been intercepted. */
export async function getFirstAttemptDate(db: D1Database, userId: number): Promise<string | null> {
  const row = await db
    .prepare(`SELECT MIN(date) AS d FROM events WHERE user_id = ?1 AND kind = '${KIND.attempt}'`)
    .bind(userId)
    .first<{ d: string | null }>()
  return row?.d ?? null
}

/**
 * Everything /review needs, in four indexed queries over a 30-day window.
 * `now` is injectable so tests can pin the day boundary.
 */
export async function getReviewStats(
  db: D1Database,
  userId: number,
  now: number = Date.now(),
): Promise<ReviewStats> {
  const today = localDate(now)
  const monthStart = shiftDate(today, -(MONTH_DAYS - 1))

  const [monthDays, apps, monthGracePasses, firstDate] = await Promise.all([
    getDailyStats(db, userId, monthStart, today),
    getAppStats(db, userId, monthStart, today),
    countGracePasses(db, userId, monthStart, today),
    getFirstAttemptDate(db, userId),
  ])

  const byDate = new Map(monthDays.map(d => [d.date, d]))
  const week = dateRange(today, WEEK_DAYS).map(d => byDate.get(d) ?? emptyDay(d))

  return {
    today,
    todayCounts: byDate.get(today) ?? emptyDay(today),
    week,
    weekTotals: sumCounts(week),
    apps,
    monthTotals: sumCounts(monthDays),
    monthActiveDays: monthDays.filter(d => d.attempts > 0).length,
    monthGracePasses,
    firstDate,
  }
}

/** Convenience wrapper for route handlers that only hold an Env. */
export function reviewStatsFor(env: Env, userId: number, now?: number): Promise<ReviewStats> {
  return getReviewStats(env.DB, userId, now)
}
