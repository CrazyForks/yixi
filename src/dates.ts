// 'YYYY-MM-DD' date-string arithmetic shared by /today and /goals. Pure
// functions, no Date.now() inside either of them — every caller supplies
// "today" itself, so tests can pin it and the two pages can never drift on
// what day it is.

import type { Goal } from './types'
import { TODAY_GOAL_LIMIT } from './types'
import type { Locale } from './i18n'

export function isExpired(goal: Pick<Goal, 'until'>, today: string): boolean {
  return goal.until !== null && goal.until < today
}

/**
 * Non-archived goals not expired as of `date`, in the order they were given.
 * This is the one selection rule /today, /today/review and the midnight
 * snapshot must never drift apart on — it used to be copy-pasted three times
 * (`goals.filter(g => g.archived_at === null && !isExpired(g, date))`), which
 * is exactly the shape of bug where one copy gets fixed and the other two
 * don't.
 */
export function liveGoals<T extends Pick<Goal, 'archived_at' | 'until'>>(goals: T[], date: string): T[] {
  return goals.filter((g) => g.archived_at === null && !isExpired(g, date))
}

/** The first TODAY_GOAL_LIMIT of `liveGoals` — the exact set /today puts a card on. */
export function shownGoals<T extends Pick<Goal, 'archived_at' | 'until'>>(goals: T[], date: string): T[] {
  return liveGoals(goals, date).slice(0, TODAY_GOAL_LIMIT)
}

// --- how a day is written out ------------------------------------------------
//
// Not `Intl.DateTimeFormat`: workerd ships a full ICU, but the two formats the
// design asks for are 「9 月 13 日 · 周日」 and 「Sep 13 · Sunday」, and neither
// is a locale pattern any CLDR skeleton produces — the middot, the omitted
// year and the 周 prefix are this product's own. Two tables and a template are
// shorter than fighting a formatter into that shape, and cannot drift when the
// runtime's ICU data is updated under us.
//
// These tables are the one place in src/ui's neighbourhood where Chinese sits
// outside `t()` on purpose: `prettyDate` is a locale-parameterised function,
// not a translated string, so wrapping 「日」 or 「周」 in a dictionary key that
// no sentence ever uses would only make the guard's job harder to read.

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The weekday of a 'YYYY-MM-DD' date, 0 = Sunday, read in UTC on the parts. */
function weekdayIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** The full weekday name in `loc` — 「周日」 / 「Sunday」. */
export function weekdayName(ymd: string, loc: Locale): string {
  const i = weekdayIndex(ymd)
  return loc === 'en' ? WEEKDAYS_EN[i]! : `周${WEEKDAYS_ZH[i]!}`
}

/**
 * The day line at the top of /today: 「9 月 13 日 · 周日」 in Chinese, 「Sep 13
 * · Sunday」 in English. No year in either — the page is about today.
 */
export function prettyDate(ymd: string, loc: Locale): string {
  const [, m, d] = ymd.split('-').map(Number) as [number, number, number]
  const day = loc === 'en' ? `${MONTHS_EN[m - 1]!} ${d}` : `${m} 月 ${d} 日`
  return `${day} · ${weekdayName(ymd, loc)}`
}

/** 'YYYY-MM-DD' ± n days, computed in UTC on the date parts so no zone drifts it. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}
