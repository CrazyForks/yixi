// 'YYYY-MM-DD' date-string arithmetic shared by /today and /goals. Pure
// functions, no Date.now() inside either of them — every caller supplies
// "today" itself, so tests can pin it and the two pages can never drift on
// what day it is.

import type { Goal } from './types'

export function isExpired(goal: Pick<Goal, 'until'>, today: string): boolean {
  return goal.until !== null && goal.until < today
}

/** 'YYYY-MM-DD' ± n days, computed in UTC on the date parts so no zone drifts it. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}
