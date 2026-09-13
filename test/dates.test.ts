// The one selection rule /today, /today/review and the midnight snapshot must
// never drift apart on. It used to be pasted three times
// (`goals.filter(g => g.archived_at === null && !isExpired(g, date))`), each
// with its own slice — this file is what keeps the merged version honest.

import { describe, expect, it } from 'vitest'
import { liveGoals, shownGoals } from '../src/dates'
import { TODAY_GOAL_LIMIT } from '../src/types'

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
})
