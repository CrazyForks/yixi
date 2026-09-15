// The one selection rule /today, /today/review and the midnight snapshot must
// never drift apart on. It used to be pasted three times
// (`goals.filter(g => g.archived_at === null && !isExpired(g, date))`), each
// with its own slice — this file is what keeps the merged version honest.

import { describe, expect, it } from 'vitest'
import { liveGoals, prettyDate, shownGoals, weekdayName } from '../src/dates'
import { TODAY_GOALS_MAX, TODAY_GOALS_MIN, TODAY_GOAL_LIMIT, todayGoalLimit } from '../src/types'

const TODAY = '2026-09-13'

interface Fixture {
  id: number
  archived_at: number | null
  until: string | null
}

function g(id: number, opts: Partial<Pick<Fixture, 'archived_at' | 'until'>> = {}): Fixture {
  return { id, archived_at: opts.archived_at ?? null, until: opts.until ?? null }
}

describe('liveGoals', () => {
  it('drops archived goals', () => {
    const a = g(1)
    const b = g(2, { archived_at: 12345 })
    expect(liveGoals([a, b], TODAY)).toEqual([a])
  })

  it('drops goals expired as of the given date, but keeps one expiring today', () => {
    const expired = g(1, { until: '2026-09-12' })
    const today = g(2, { until: TODAY })
    const future = g(3, { until: '2026-09-14' })
    const openEnded = g(4, { until: null })
    expect(liveGoals([expired, today, future, openEnded], TODAY)).toEqual([today, future, openEnded])
  })

  it('preserves the original order', () => {
    const goals = [g(3), g(1), g(2)]
    expect(liveGoals(goals, TODAY).map((x) => x.id)).toEqual([3, 1, 2])
  })

  it('is not itself limited — that is shownGoals’s job', () => {
    const goals = Array.from({ length: TODAY_GOAL_LIMIT + 2 }, (_, i) => g(i))
    expect(liveGoals(goals, TODAY)).toHaveLength(TODAY_GOAL_LIMIT + 2)
  })
})

describe('shownGoals', () => {
  it('caps at TODAY_GOAL_LIMIT, keeping the first ones in order', () => {
    const goals = Array.from({ length: TODAY_GOAL_LIMIT + 2 }, (_, i) => g(i))
    expect(shownGoals(goals, TODAY).map((x) => x.id)).toEqual(
      Array.from({ length: TODAY_GOAL_LIMIT }, (_, i) => i),
    )
  })

  it('applies the same archived/expiry filter as liveGoals before slicing', () => {
    const archived = g(1, { archived_at: 1 })
    const expired = g(2, { until: '2026-09-01' })
    const live1 = g(3)
    const live2 = g(4)
    expect(shownGoals([archived, expired, live1, live2], TODAY)).toEqual([live1, live2])
  })

  it('returns fewer than the limit when there are fewer live goals', () => {
    const only = g(1)
    expect(shownGoals([only], TODAY)).toEqual([only])
  })

  it('honours a caller-supplied limit, filtering first and slicing second', () => {
    const goals = [g(1, { archived_at: 1 }), g(2), g(3), g(4), g(5)]
    expect(shownGoals(goals, TODAY, 1).map((x) => x.id)).toEqual([2])
    expect(shownGoals(goals, TODAY, 4).map((x) => x.id)).toEqual([2, 3, 4, 5])
    // Asking for more than there are is not an error, it is just all of them.
    expect(shownGoals(goals, TODAY, 9).map((x) => x.id)).toEqual([2, 3, 4, 5])
  })

  it('still caps at TODAY_GOAL_LIMIT when no limit is given', () => {
    const goals = Array.from({ length: TODAY_GOAL_LIMIT + 2 }, (_, i) => g(i))
    expect(shownGoals(goals, TODAY)).toHaveLength(TODAY_GOAL_LIMIT)
    expect(TODAY_GOAL_LIMIT).toBe(3)
  })
})

// The clamp between the column and every page that reads it. A stored value
// is only a number somebody once posted, and `slice()` would take any of them.
describe('todayGoalLimit', () => {
  it('uses the stored number when it is one of the nine the form can produce', () => {
    for (let n = TODAY_GOALS_MIN; n <= TODAY_GOALS_MAX; n++) {
      expect(todayGoalLimit({ today_goals: n })).toBe(n)
    }
  })

  it('falls back to the default for never-chosen, out-of-range and non-integer values', () => {
    expect(todayGoalLimit({})).toBe(TODAY_GOAL_LIMIT)
    expect(todayGoalLimit({ today_goals: null })).toBe(TODAY_GOAL_LIMIT)
    expect(todayGoalLimit({ today_goals: 0 })).toBe(TODAY_GOAL_LIMIT)
    expect(todayGoalLimit({ today_goals: -1 })).toBe(TODAY_GOAL_LIMIT)
    expect(todayGoalLimit({ today_goals: TODAY_GOALS_MAX + 1 })).toBe(TODAY_GOAL_LIMIT)
    expect(todayGoalLimit({ today_goals: 2.5 })).toBe(TODAY_GOAL_LIMIT)
    expect(todayGoalLimit({ today_goals: NaN })).toBe(TODAY_GOAL_LIMIT)
  })
})

// prettyDate moved here out of src/ui/today.ts when it grew a locale: the day
// line is the one string on /today that is not a dictionary entry, so its two
// shapes are pinned here rather than inferred from a rendered page.
describe('prettyDate', () => {
  it('writes a Chinese day as 「9 月 13 日 · 周日」', () => {
    expect(prettyDate('2026-09-13', 'zh')).toBe('9 月 13 日 · 周日')
    expect(prettyDate('2026-01-01', 'zh')).toBe('1 月 1 日 · 周四')
  })

  it('writes an English day as 「Sep 13 · Sunday」, with no year and no leading zero', () => {
    expect(prettyDate('2026-09-13', 'en')).toBe('Sep 13 · Sunday')
    expect(prettyDate('2026-01-01', 'en')).toBe('Jan 1 · Thursday')
  })

  it('names the weekday in either language', () => {
    expect(weekdayName('2026-09-13', 'zh')).toBe('周日')
    expect(weekdayName('2026-09-13', 'en')).toBe('Sunday')
    expect(weekdayName('2026-09-19', 'zh')).toBe('周六')
    expect(weekdayName('2026-09-19', 'en')).toBe('Saturday')
  })
})
