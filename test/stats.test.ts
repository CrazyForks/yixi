import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import {
  MONTH_DAYS,
  WEEK_DAYS,
  countGracePasses,
  dateRange,
  getAppStats,
  getDailyStats,
  getFirstAttemptDate,
  getReviewStats,
  localDate,
  shiftDate,
  sumCounts,
} from '../src/stats'
import { renderReview } from '../src/ui/review'
import type { Env, EventKind, User } from '../src/types'

const DB = env.DB

// Every test picks its own user id so a leak between suites shows up as a
// wrong number rather than as a passing test that happens to share rows.
let sidSeq = 0
const nextSid = () => `sid-${++sidSeq}`

const at = (iso: string) => Date.parse(iso)

/**
 * grace_pass has no session behind it, so src/gate.ts writes the empty-string
 * sentinel into the NOT NULL sid column. Mirrored here, because "every noise row
 * in the table shares one sid" is exactly the shape that could fan out a join.
 */
const NO_SESSION = ''

async function event(
  userId: number,
  kind: EventKind,
  ts: number,
  opts: { app?: string; sid?: string } = {},
): Promise<string> {
  const sid = opts.sid ?? (kind === 'grace_pass' ? NO_SESSION : nextSid())
  await DB.prepare(
    `INSERT INTO events (user_id, sid, app, kind, ts, date) VALUES (?1,?2,?3,?4,?5,?6)`,
  )
    .bind(userId, sid, opts.app ?? 'xhs', kind, ts, localDate(ts))
    .run()
  return sid
}

/**
 * One full interception: the attempt, plus the outcome the user eventually
 * picked. `outcome: null` is the real "opened the breathing page and swiped
 * away" case. `resolveTs` defaults to the attempt instant, but is settable so a
 * decision can land on the next calendar day.
 */
async function interception(
  userId: number,
  ts: number,
  outcome: 'proceeded' | 'abandoned' | null,
  opts: { app?: string; resolveTs?: number } = {},
): Promise<string> {
  const sid = await event(userId, 'attempt', ts, { app: opts.app })
  if (outcome) await event(userId, outcome, opts.resolveTs ?? ts, { app: opts.app, sid })
  return sid
}

async function addUserApp(userId: number, app: string, label: string): Promise<void> {
  await DB.prepare(
    `INSERT INTO user_apps (user_id, app, label, scheme, wait_seconds, grace_seconds, enabled)
     VALUES (?1,?2,?3,?4,10,90,1)`,
  )
    .bind(userId, app, label, `${app}://`)
    .run()
}

const testUser = (id: number, name = '测试'): User => ({
  id,
  name,
  is_owner: 0,
  created_at: Date.parse('2026-01-01T00:00:00Z'),
})

const testEnv: Env = { DB, COOKIE_SECRET: env.COOKIE_SECRET, TOKEN_KEY: env.TOKEN_KEY }

// --------------------------------------------------------------------------

describe('local day arithmetic (Asia/Shanghai, UTC+8, no DST)', () => {
  it('maps an instant to the Shanghai calendar day, not the UTC one', () => {
    // 23:59:59 Shanghai on 08-30 is still 15:59:59Z.
    expect(localDate(at('2026-08-30T15:59:59Z'))).toBe('2026-08-30')
    // One second later it is 00:00:00 on 08-31 locally, while UTC is still 08-30.
    expect(localDate(at('2026-08-30T16:00:00Z'))).toBe('2026-08-31')
  })

  it('shiftDate crosses month and year boundaries', () => {
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31')
    expect(shiftDate('2026-02-28', 1)).toBe('2026-03-01') // 2026 is not a leap year
    expect(shiftDate('2026-08-30', -(MONTH_DAYS - 1))).toBe('2026-08-01')
  })

  it('dateRange returns `days` consecutive ascending days ending at endDate', () => {
    const r = dateRange('2026-08-30', WEEK_DAYS)
    expect(r).toHaveLength(WEEK_DAYS)
    expect(r[0]).toBe('2026-08-24')
    expect(r[WEEK_DAYS - 1]).toBe('2026-08-30')
  })
})

describe('grace_pass is excluded from every statistic', () => {
  it('does not touch attempts, outcomes, or the abandon rate', async () => {
    const u = 101
    await interception(u, at('2026-08-20T02:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-20T03:00:00Z'), 'proceeded')
    // The automation re-firing five times as we hand control back.
    for (let i = 0; i < 5; i++) {
      await event(u, 'grace_pass', at('2026-08-20T03:00:00Z') + i * 1000)
    }

    const [day] = await getDailyStats(DB, u, '2026-08-20', '2026-08-20')
    expect(day).toBeDefined()
    expect(day!.attempts).toBe(2)
    expect(day!.abandoned).toBe(1)
    expect(day!.proceeded).toBe(1)
    expect(day!.undecided).toBe(0)
    // 1/2, not 1/7 — the whole point.
    expect(day!.abandonRate).toBe(0.5)
  })

  it('is invisible to the per-app ranking too', async () => {
    const u = 102
    await interception(u, at('2026-08-20T02:00:00Z'), 'abandoned', { app: 'xhs' })
    for (let i = 0; i < 4; i++) {
      await event(u, 'grace_pass', at('2026-08-20T04:00:00Z') + i * 1000, { app: 'xhs' })
    }
    const apps = await getAppStats(DB, u, '2026-08-20', '2026-08-20')
    expect(apps).toHaveLength(1)
    expect(apps[0]!.attempts).toBe(1)
    expect(apps[0]!.abandonRate).toBe(1)
  })

  it('does not fan a day\u2019s attempts out across the shared empty sid', async () => {
    const u = 103
    // Every grace_pass ever written by this user carries sid = ''. If any query
    // joined attempts to events on sid without excluding the sentinel, these 20
    // noise rows would multiply the day's attempts instead of being ignored.
    await interception(u, at('2026-08-20T01:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-20T02:00:00Z'), null)
    for (let i = 0; i < 20; i++) {
      await event(u, 'grace_pass', at('2026-08-20T03:00:00Z') + i * 1000)
    }
    const rows = await DB.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE user_id = ?1 AND sid = ''`,
    )
      .bind(u)
      .first<{ n: number }>()
    expect(rows!.n).toBe(20) // the sentinel really is shared

    const [day] = await getDailyStats(DB, u, '2026-08-20', '2026-08-20')
    expect(day!.attempts).toBe(2)
    expect(day!.abandoned).toBe(1)
    expect(day!.undecided).toBe(1)
    expect(day!.abandonRate).toBe(0.5)
  })

  it('is still ignored if a noise row ever borrows a real attempt\u2019s sid', async () => {
    const u = 106
    const sid = await interception(u, at('2026-08-20T02:00:00Z'), null)
    await event(u, 'grace_pass', at('2026-08-20T02:00:05Z'), { sid })
    const [day] = await getDailyStats(DB, u, '2026-08-20', '2026-08-20')
    expect(day!.attempts).toBe(1)
    expect(day!.undecided).toBe(1)
  })

  it('is reported separately so the exclusion is visible, not hidden', async () => {
    const u = 104
    await interception(u, at('2026-08-20T02:00:00Z'), 'abandoned')
    await event(u, 'grace_pass', at('2026-08-20T02:00:05Z'))
    await event(u, 'grace_pass', at('2026-08-21T02:00:05Z'))
    expect(await countGracePasses(DB, u, '2026-08-20', '2026-08-21')).toBe(2)
    // Window-scoped, like every other figure.
    expect(await countGracePasses(DB, u, '2026-08-20', '2026-08-20')).toBe(1)
    // And it never becomes the first recorded day.
    const uEmpty = 105
    await event(uEmpty, 'grace_pass', at('2026-08-20T02:00:05Z'))
    expect(await getFirstAttemptDate(DB, uEmpty)).toBeNull()
  })
})

describe('abandon rate arithmetic', () => {
  it('is abandoned / attempts', async () => {
    const u = 111
    await interception(u, at('2026-08-20T01:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-20T02:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-20T03:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-20T04:00:00Z'), 'proceeded')
    const [day] = await getDailyStats(DB, u, '2026-08-20', '2026-08-20')
    expect(day!.attempts).toBe(4)
    expect(day!.abandonRate).toBe(0.75)
    expect(day!.undecided).toBe(0)
  })

  it('keeps unresolved sessions out of both outcome columns', async () => {
    const u = 112
    await interception(u, at('2026-08-20T01:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-20T02:00:00Z'), 'proceeded')
    await interception(u, at('2026-08-20T03:00:00Z'), null)
    await interception(u, at('2026-08-20T04:00:00Z'), null)
    const [day] = await getDailyStats(DB, u, '2026-08-20', '2026-08-20')
    expect(day!.attempts).toBe(4)
    expect(day!.abandoned).toBe(1)
    expect(day!.proceeded).toBe(1)
    // attempts − proceeded − abandoned, surfaced rather than folded into either side.
    expect(day!.undecided).toBe(2)
    expect(day!.abandonRate).toBe(0.25)
  })

  it('returns null — never NaN — when there is no denominator', async () => {
    const rows = await getDailyStats(DB, 113, '2026-08-01', '2026-08-30')
    expect(rows).toEqual([])
    const totals = sumCounts(rows)
    expect(totals.attempts).toBe(0)
    expect(totals.abandonRate).toBeNull()
    expect(Number.isNaN(totals.abandonRate as unknown as number)).toBe(false)
  })

  it('sumCounts recomputes the rate from the summed totals, not by averaging rates', async () => {
    const u = 114
    // Day 1: 1/1 = 100%. Day 2: 1/9 ≈ 11%. Averaging the two rates gives ~56%;
    // the true pooled rate is 2/10 = 20%.
    await interception(u, at('2026-08-20T01:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-21T01:00:00Z'), 'abandoned')
    for (let i = 0; i < 8; i++) {
      await interception(u, at('2026-08-21T02:00:00Z') + i * 60_000, 'proceeded')
    }
    const rows = await getDailyStats(DB, u, '2026-08-20', '2026-08-21')
    expect(rows).toHaveLength(2)
    expect(sumCounts(rows).abandonRate).toBeCloseTo(0.2, 10)
  })
})

describe('day boundaries', () => {
  it('groups by the Shanghai local day already stored on the event', async () => {
    const u = 121
    await interception(u, at('2026-08-20T15:00:00Z'), 'abandoned') // 23:00 on 08-20
    await interception(u, at('2026-08-20T16:30:00Z'), 'proceeded') // 00:30 on 08-21
    const rows = await getDailyStats(DB, u, '2026-08-20', '2026-08-21')
    expect(rows.map(r => r.date)).toEqual(['2026-08-20', '2026-08-21'])
    expect(rows[0]!.abandoned).toBe(1)
    expect(rows[1]!.proceeded).toBe(1)
  })

  it('attributes a decision made after midnight to the day of the impulse', async () => {
    const u = 122
    // Intercepted at 23:59:50 local, tapped 「算了」15 seconds later — the next day.
    await interception(u, at('2026-08-20T15:59:50Z'), 'abandoned', {
      resolveTs: at('2026-08-20T16:00:05Z'),
    })
    const rows = await getDailyStats(DB, u, '2026-08-20', '2026-08-21')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.date).toBe('2026-08-20')
    expect(rows[0]!.attempts).toBe(1)
    expect(rows[0]!.abandoned).toBe(1)
    // The trap this guards: counting kinds per-day would leave 08-20 with
    // attempts=1, abandoned=0 (undecided=1) and 08-21 with attempts=0,
    // abandoned=1 — i.e. a negative residual on a day with no impulses.
    expect(rows[0]!.undecided).toBe(0)
  })

  it('honours the inclusive window edges', async () => {
    const u = 123
    await interception(u, at('2026-08-19T02:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-20T02:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-26T02:00:00Z'), 'abandoned')
    await interception(u, at('2026-08-27T02:00:00Z'), 'abandoned')
    const rows = await getDailyStats(DB, u, '2026-08-20', '2026-08-26')
    expect(rows.map(r => r.date)).toEqual(['2026-08-20', '2026-08-26'])
  })

  it('never returns a day outside the requested window, even for cross-midnight decisions', async () => {
    const u = 124
    await interception(u, at('2026-08-19T15:59:50Z'), 'proceeded', {
      resolveTs: at('2026-08-19T16:00:10Z'), // lands on 08-20
    })
    const rows = await getDailyStats(DB, u, '2026-08-20', '2026-08-26')
    expect(rows).toEqual([])
  })
})

describe('per-app ranking', () => {
  it('orders by attempts and carries each app its own rate', async () => {
    const u = 131
    await addUserApp(u, 'xhs', '小红书')
    await addUserApp(u, 'dy', '抖音')
    for (let i = 0; i < 3; i++) {
      await interception(u, at('2026-08-20T01:00:00Z') + i * 60_000, 'abandoned', { app: 'xhs' })
    }
    for (let i = 0; i < 5; i++) {
      await interception(u, at('2026-08-20T02:00:00Z') + i * 60_000, i === 0 ? 'abandoned' : 'proceeded', {
        app: 'dy',
      })
    }
    const apps = await getAppStats(DB, u, '2026-08-20', '2026-08-20')
    expect(apps.map(a => a.label)).toEqual(['抖音', '小红书'])
    expect(apps[0]!.attempts).toBe(5)
    expect(apps[0]!.abandonRate).toBe(0.2)
    expect(apps[1]!.attempts).toBe(3)
    expect(apps[1]!.abandonRate).toBe(1)
  })

  it('still reports an app that has since been deleted from the config', async () => {
    const u = 132
    await interception(u, at('2026-08-20T01:00:00Z'), 'proceeded', { app: 'bili' })
    const apps = await getAppStats(DB, u, '2026-08-20', '2026-08-20')
    expect(apps).toHaveLength(1)
    // Falls back to the raw key rather than dropping the history.
    expect(apps[0]!.label).toBe('bili')
  })
})

describe('getReviewStats', () => {
  const now = at('2026-08-30T04:00:00Z') // 12:00 on 2026-08-30 in Shanghai

  it('assembles today, the week window and the month window off one clock', async () => {
    const u = 141
    await addUserApp(u, 'xhs', '小红书')
    await interception(u, at('2026-08-30T03:00:00Z'), 'abandoned', { app: 'xhs' }) // today
    await interception(u, at('2026-08-30T03:10:00Z'), 'proceeded', { app: 'xhs' }) // today
    await interception(u, at('2026-08-27T03:00:00Z'), 'abandoned', { app: 'xhs' }) // in week
    await interception(u, at('2026-08-10T03:00:00Z'), null, { app: 'xhs' }) // month only
    await event(u, 'grace_pass', at('2026-08-30T03:11:00Z'), { app: 'xhs' })

    const s = await getReviewStats(DB, u, now)
    expect(s.today).toBe('2026-08-30')
    expect(s.todayCounts.attempts).toBe(2)
    expect(s.todayCounts.abandonRate).toBe(0.5)

    expect(s.week).toHaveLength(WEEK_DAYS)
    expect(s.week[0]!.date).toBe('2026-08-24')
    expect(s.week[WEEK_DAYS - 1]!.date).toBe('2026-08-30')
    expect(s.weekTotals.attempts).toBe(3)
    expect(s.weekTotals.abandoned).toBe(2)

    expect(s.monthTotals.attempts).toBe(4)
    expect(s.monthTotals.undecided).toBe(1)
    expect(s.monthActiveDays).toBe(3)
    expect(s.monthGracePasses).toBe(1)
    expect(s.firstDate).toBe('2026-08-10')
    expect(s.apps[0]!.label).toBe('小红书')
  })

  it('zero-fills quiet days inside the week instead of dropping them', async () => {
    const u = 142
    await interception(u, at('2026-08-30T03:00:00Z'), 'abandoned')
    const s = await getReviewStats(DB, u, now)
    expect(s.week.map(d => d.date)).toEqual(dateRange('2026-08-30', WEEK_DAYS))
    expect(s.week.slice(0, 6).every(d => d.attempts === 0 && d.abandonRate === null)).toBe(true)
    expect(s.week[6]!.attempts).toBe(1)
  })

  it('excludes events older than the month window', async () => {
    const u = 143
    await interception(u, at('2026-07-20T03:00:00Z'), 'abandoned') // far outside
    const s = await getReviewStats(DB, u, now)
    expect(s.monthTotals.attempts).toBe(0)
    expect(s.apps).toEqual([])
    // firstDate is lifetime, not windowed — it is what tells the page whether
    // this is a brand-new user or just a quiet month.
    expect(s.firstDate).toBe('2026-07-20')
  })

  it('does not leak another user’s events', async () => {
    const mine = 144
    const theirs = 145
    await interception(mine, at('2026-08-30T03:00:00Z'), 'abandoned')
    for (let i = 0; i < 6; i++) {
      await interception(theirs, at('2026-08-30T03:00:00Z') + i * 1000, 'proceeded')
    }
    const s = await getReviewStats(DB, mine, now)
    expect(s.todayCounts.attempts).toBe(1)
    expect(s.todayCounts.proceeded).toBe(0)
    expect(s.monthTotals.attempts).toBe(1)
  })

  it('returns a fully zeroed, NaN-free shape for a user with no events at all', async () => {
    const s = await getReviewStats(DB, 146, now)
    expect(s.firstDate).toBeNull()
    expect(s.apps).toEqual([])
    expect(s.monthGracePasses).toBe(0)
    expect(s.todayCounts).toEqual({
      date: '2026-08-30',
      attempts: 0,
      proceeded: 0,
      abandoned: 0,
      undecided: 0,
      abandonRate: null,
    })
    expect(s.week).toHaveLength(WEEK_DAYS)
    expect(s.week.every(d => d.abandonRate === null)).toBe(true)
    expect(s.monthTotals.abandonRate).toBeNull()
    expect(s.monthActiveDays).toBe(0)
  })
})

describe('/review rendering', () => {
  const req = new Request('https://yixi.example/review')

  it('shows a friendly empty state — no zeros wall, no NaN — for a new user', async () => {
    const res = await renderReview(req, testEnv, testUser(151))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).not.toContain('NaN')
    expect(body).not.toContain('undefined')
    expect(body).toContain('还没有记录')
  })

  it('renders every headline number for a user with data', async () => {
    const u = 152
    await addUserApp(u, 'xhs', '小红书')
    const now = Date.now()
    await interception(u, now - 60_000, 'abandoned', { app: 'xhs' })
    await interception(u, now - 30_000, 'proceeded', { app: 'xhs' })
    await interception(u, now - 10_000, null, { app: 'xhs' })
    await event(u, 'grace_pass', now - 5_000, { app: 'xhs' })

    const body = await (await renderReview(req, testEnv, testUser(u))).text()
    expect(body).not.toContain('NaN')
    expect(body).toContain('小红书')
    expect(body).toContain('忍住')
    expect(body).toContain('没做选择')
    expect(body).toContain('放弃率')
    // 1 abandoned / 3 attempts
    expect(body).toContain('33%')
    // The excluded noise is disclosed rather than silently dropped.
    expect(body).toContain('机器噪音')
  })

  it('escapes app labels and user names taken from the database', async () => {
    const u = 153
    await addUserApp(u, 'evil', '<img src=x onerror=alert(1)>')
    await interception(u, Date.now() - 60_000, 'abandoned', { app: 'evil' })
    const body = await (await renderReview(req, testEnv, testUser(u, '<script>bad</script>'))).text()
    expect(body).not.toContain('<img src=x')
    expect(body).not.toContain('<script>bad')
    expect(body).toContain('&lt;img src=x')
  })
})
