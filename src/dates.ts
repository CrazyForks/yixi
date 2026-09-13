// 'YYYY-MM-DD' date-string arithmetic shared by /today and /goals. Pure
// functions, no Date.now() inside either of them — every caller supplies
// "today" itself, so tests can pin it and the two pages can never drift on
// what day it is.

import type { Goal } from './types'
import { TODAY_GOAL_LIMIT } from './types'

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

/** 'YYYY-MM-DD' ± n days, computed in UTC on the date parts so no zone drifts it. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}
