// /today/review — 「回看」. Counterpart test file to test/review.test.ts,
// except there is no such file: /review's tests live scattered across
// stats.test.ts. This one is self-contained, the way today.test.ts is.
//
// The scenario below is deliberately built relative to *whatever day the
// suite happens to run on* (`Date.now()`, same convention as today.test.ts)
// rather than a hardcoded date — renderProgress takes no injectable clock, so
// every fixture is expressed as an offset from `TODAY`/`MONDAY`, computed the
// same way at test-authoring time as at render time. That is what makes the
// Sunday-night/Monday-morning boundary check meaningful on every day of the
// week the suite is run, not just the one day it was written on.

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderProgress } from '../src/ui/progress'
import {
  createGoal,
  createTask,
  deleteGoal,
  setGoalArchived,
  setTaskDone,
  shanghaiDate,
  toggleCheckin,
  upsertGoalDay,
} from '../src/db'
import { addDays } from '../src/dates'
import type { User } from '../src/types'

const BASE = 'https://yixi.example.workers.dev'
const NOW = Date.now()
const TODAY = shanghaiDate(NOW)

const user: User = { id: 1, name: '张三', is_owner: 0, created_at: 0 }
const user2: User = { id: 2, name: '李四', is_owner: 0, created_at: 0 }

function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sun … 6 = Sat
  return addDays(date, -((dow + 6) % 7))
}
const MONDAY = mondayOf(TODAY)

/** Epoch ms for a Shanghai-local date + time, same idiom as goals-db.test.ts. */
function tsAt(date: string, time = '09:00:00'): number {
  return Date.parse(`${date}T${time}+08:00`)
}

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM goal_days'),
    env.DB.prepare('DELETE FROM goal_checkins'),
    env.DB.prepare('DELETE FROM goal_tasks'),
    env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM users'),
  ])
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (1, '张三', 'h1', 0, 0)"),
    env.DB.prepare("INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (2, '李四', 'h2', 0, 0)"),
  ])
}
beforeEach(reset)

async function render(u: User = user): Promise<string> {
  const res = await renderProgress(new Request(`${BASE}/today/review`), env, u)
  expect(res.status).toBe(200)
  return await res.text()
}

function mainOf(html: string): string {
  const m = html.match(/<main>([\s\S]*?)<\/main>/)
  expect(m, 'no <main> found').toBeTruthy()
  return m![1]!
}

describe('empty state', () => {
  it('shows the empty state when there are no goals and no snapshots', async () => {
    const html = await render()
    const main = mainOf(html)
    expect(main).toContain('还没有可以回看的')
    expect(main).toContain('<a href="/today">今日</a>')
  })

  it('still renders the shared 今日 nav with 回看 current', async () => {
    const html = await render()
    expect(html).toMatch(/<a href="\/today\/review" class="on" aria-current="page"/)
  })
})

/**
 * One goal graveyard set up so every section of the page has something real
 * to say. Everything is expressed as an offset from TODAY/MONDAY so the
 * scenario holds whatever day the suite runs on.
 *
 *   A 健身  — created 40 days ago (well over the 30-day window): checked
 *             today, and on day -7, -15, -20, -25. Only "today" falls in the
 *             last-7-day dot window (-6..0), so its dots are 6 off + today on.
 *             5 checkins inside the 30-day window, denom stays 30.
 *   B 阅读  — created 4 days ago: checked on -4, -2 and today — all three
 *             inside both the 7-day and 30-day windows. denom shrinks to 5
 *             (min(30, daysSince)).
 *   C 英语  — created 40 days ago, no checkins at all, NOT checked today.
 *             Exists purely so the top-3 selection has a third member and
 *             "today" is 2/3, not 2/2.
 *   D 写作<b>加粗</b> — created 40 days ago, the 4th live goal (beyond
 *             TODAY_GOAL_LIMIT=3, so it never enters "today"'s shown/done).
 *             Checked today AND on day -10 — the checkin today must NOT move
 *             the "今天" counters, proving non-top goals are excluded there.
 *             Its title carries markup to assert escapeHtml is applied.
 *   E 已归档目标 — archived; must vanish from the per-goal list, from "今天"'s
 *             shown count, and must not flip the empty-state check.
 *
 * goal_days snapshot rows, all inside the 30-day window and clear of the
 * 7-day dot window so they cannot be confused with per-goal checkin data:
 *   day -25: shown 2, done 2 (a "full" day)
 *   day -20: shown 3, done 1
 *   day -15: shown 0, done 0 (a "zero" day)
 *   TODAY:   a deliberately wrong stored row (shown 99, done 99) to prove the
 *            live value overrides whatever (if anything) is on disk for today.
 *
 * goal_tasks done at the Monday/Sunday boundary, attached to goal A:
 *   Sunday 23:30 the week before MONDAY  — must be excluded ("last week").
 *   Monday 00:30 (MONDAY itself)         — must be included.
 *   Today 08:00                          — must be included (inclusive of today).
 */
async function setupScenario(): Promise<{ a: number; b: number; c: number; d: number; e: number }> {
  const a = await createGoal(env.DB, {
    userId: 1, title: '健身', cue: '', target: '', targetLabel: '', until: null, now: tsAt(addDays(TODAY, -40)),
  })
  const b = await createGoal(env.DB, {
    userId: 1, title: '阅读', cue: '', target: '', targetLabel: '', until: null, now: tsAt(addDays(TODAY, -4)),
  })
  const c = await createGoal(env.DB, {
    userId: 1, title: '英语', cue: '', target: '', targetLabel: '', until: null, now: tsAt(addDays(TODAY, -40)),
  })
  const d = await createGoal(env.DB, {
    userId: 1, title: '写作<b>加粗</b>', cue: '', target: '', targetLabel: '', until: null, now: tsAt(addDays(TODAY, -40)),
  })
  const e = await createGoal(env.DB, {
    userId: 1, title: '已归档目标', cue: '', target: '', targetLabel: '', until: null, now: tsAt(addDays(TODAY, -40)),
  })
  await setGoalArchived(env.DB, 1, e, NOW)

  for (const offset of [0, -7, -15, -20, -25]) {
    await toggleCheckin(env.DB, 1, a, addDays(TODAY, offset), tsAt(addDays(TODAY, offset)))
  }
  for (const offset of [-4, -2, 0]) {
    await toggleCheckin(env.DB, 1, b, addDays(TODAY, offset), tsAt(addDays(TODAY, offset)))
  }
  for (const offset of [0, -10]) {
    await toggleCheckin(env.DB, 1, d, addDays(TODAY, offset), tsAt(addDays(TODAY, offset)))
  }
  // Archived goal E still gets a checkin today, to prove it cannot leak into
  // "今天"'s shown/done even though the row exists.
  await toggleCheckin(env.DB, 1, e, TODAY, tsAt(TODAY))

  await upsertGoalDay(env.DB, { user_id: 1, date: addDays(TODAY, -25), shown: 2, done: 2, tasks_done: 0, ts: 1 })
  await upsertGoalDay(env.DB, { user_id: 1, date: addDays(TODAY, -20), shown: 3, done: 1, tasks_done: 0, ts: 2 })
  await upsertGoalDay(env.DB, { user_id: 1, date: addDays(TODAY, -15), shown: 0, done: 0, tasks_done: 0, ts: 3 })
  await upsertGoalDay(env.DB, { user_id: 1, date: TODAY, shown: 99, done: 99, tasks_done: 0, ts: 4 })

  const sunBefore = addDays(MONDAY, -1)
  const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '周日夜', now: tsAt(sunBefore) }))!
  const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '周一晨', now: tsAt(MONDAY) }))!
  const t3 = (await createTask(env.DB, { userId: 1, goalId: a, title: '今天', now: tsAt(TODAY) }))!
  await setTaskDone(env.DB, 1, t1, tsAt(sunBefore, '23:30:00'))
  await setTaskDone(env.DB, 1, t2, tsAt(MONDAY, '00:30:00'))
  await setTaskDone(env.DB, 1, t3, tsAt(TODAY, '08:00:00'))

  return { a, b, c, d, e }
}

describe('with goals and history', () => {
  it('computes "今天" live from the same top-3 selection /today uses, excluding non-top and archived goals', async () => {
    await setupScenario()
    const main = mainOf(await render())
    expect(main).toContain('<b class="num">2</b> / <span class="num">3</span>')
  })

  it('draws 30 bars, today rightmost, with .none/.zero/height rules and today overriding any stored row', async () => {
    await setupScenario()
    const main = mainOf(await render())
    const bars = main.match(/<i class="bar[^>]*>/g) ?? []
    expect(bars).toHaveLength(30)

    const idx = (offset: number) => offset + 29 // days[] runs TODAY-29 .. TODAY, ascending
    expect(bars[idx(-25)]).toContain('--h:1.00')
    expect(bars[idx(-20)]).toContain('--h:0.33')
    expect(bars[idx(-15)]).toBe('<i class="bar zero">')
    // Today: live 2/3, NOT the stale stored 99/99 row.
    expect(bars[29]).toContain('--h:0.67')
    expect(bars[29]).not.toContain('99')

    const withData = new Set([idx(-25), idx(-20), idx(-15), 29])
    const nones = bars.filter((b, i) => !withData.has(i))
    expect(nones).toHaveLength(26)
    for (const b of nones) expect(b).toBe('<i class="bar none">')
  })

  it('foots the 30-day strip with the count that has a snapshot and the count that is complete', async () => {
    await setupScenario()
    const main = mainOf(await render())
    // 4 days carry data (day -25, -20, -15, and today via live override);
    // only day -25 (2/2) is a complete day.
    expect(main).toContain('30 天里有记录的 4 天，做完全部的 1 天。')
  })

  it('gives every non-archived goal 7 dots (today last) and a 30-day rate, shrinking the denominator for a new goal', async () => {
    await setupScenario()
    const main = mainOf(await render())

    const off = (cls: string) => `<i class="d${cls}"></i>`
    const goalARow =
      `<li><span class="gt">健身</span><span class="dots" aria-label="最近七天">` +
      off('') + off('') + off('') + off('') + off('') + off('') + off(' on') +
      `</span><span class="rate num">30 天 · 打卡 5 天</span></li>`
    expect(main).toContain(goalARow)

    const goalBRow =
      `<li><span class="gt">阅读</span><span class="dots" aria-label="最近七天">` +
      off('') + off('') + off(' on') + off('') + off(' on') + off('') + off(' on') +
      `</span><span class="rate num">5 天 · 打卡 3 天</span></li>`
    expect(main).toContain(goalBRow)

    // Goal C: no checkins at all.
    expect(main).toContain('<span class="gt">英语</span>')
    expect(main).toContain('30 天 · 打卡 0 天')
  })

  it('lists a goal beyond the today-3 limit too, but its checkin today never moves the "今天" counters', async () => {
    await setupScenario()
    const main = mainOf(await render())
    expect(main).toContain('30 天 · 打卡 2 天') // goal D: today + day -10
    expect(main).toContain('<b class="num">2</b> / <span class="num">3</span>')
  })

  it('escapes a goal title through escapeHtml', async () => {
    await setupScenario()
    const html = await render()
    expect(html).toContain('写作&lt;b&gt;加粗&lt;/b&gt;')
    expect(html).not.toContain('写作<b>加粗</b>')
  })

  it('never shows an archived goal, in the list or in "今天"', async () => {
    await setupScenario()
    const main = mainOf(await render())
    expect(main).not.toContain('已归档目标')
  })

  it('counts this week\'s finished sub-tasks from Monday through today, not from a sliding 7 days', async () => {
    await setupScenario()
    const main = mainOf(await render())
    // Sunday night (last week) excluded; Monday morning + today both included.
    expect(main).toContain('划掉了 <b class="num">2</b> 条子任务')
  })

  it('marks 回看 as the current tab', async () => {
    await setupScenario()
    const html = await render()
    expect(html).toMatch(/<a href="\/today\/review" class="on" aria-current="page"/)
  })

  it('never leaks another user\'s goals, checkins or tasks', async () => {
    const ids = await setupScenario()
    await createGoal(env.DB, {
      userId: 2, title: '别人的目标', cue: '', target: '', targetLabel: '', until: null, now: tsAt(addDays(TODAY, -40)),
    })
    const otherGoalRows = await env.DB
      .prepare('SELECT id FROM goals WHERE user_id = 2')
      .all<{ id: number }>()
    const otherGoalId = otherGoalRows.results[0]!.id
    await toggleCheckin(env.DB, 2, otherGoalId, TODAY, tsAt(TODAY))
    const otherTask = (await createTask(env.DB, { userId: 2, goalId: otherGoalId, title: 'x', now: tsAt(TODAY) }))!
    await setTaskDone(env.DB, 2, otherTask, tsAt(MONDAY, '00:30:00'))

    const mine = mainOf(await render(user))
    expect(mine).not.toContain('别人的目标')
    // user 1's numbers are unaffected by user 2's data.
    expect(mine).toContain('<b class="num">2</b> / <span class="num">3</span>')
    expect(mine).toContain('划掉了 <b class="num">2</b> 条子任务')

    const theirs = mainOf(await render(user2))
    expect(theirs).toContain('别人的目标')
    expect(theirs).not.toContain('健身')
    expect(theirs).not.toContain('阅读')
    expect(ids.a).toBeGreaterThan(0)
  })

  it('still gives an expired-but-not-archived goal its own per-goal row, but excludes it from the today count (design §3.3)', async () => {
    const live = await createGoal(env.DB, {
      userId: 1, title: '在场目标', cue: '', target: '', targetLabel: '', until: null, now: tsAt(addDays(TODAY, -4)),
    })
    const expired = await createGoal(env.DB, {
      userId: 1, title: '过期未归档', cue: '', target: '', targetLabel: '', until: addDays(TODAY, -1), now: tsAt(addDays(TODAY, -4)),
    })
    await toggleCheckin(env.DB, 1, expired, TODAY, tsAt(TODAY))

    const main = mainOf(await render())
    // Per-goal row still there, with its check-in reflected in the rate.
    expect(main).toContain('<span class="gt">过期未归档</span>')
    expect(main).toContain('5 天 · 打卡 1 天')
    // "今天" only counts the still-live goal (unchecked), never the expired one.
    expect(main).toContain('<b class="num">0</b> / <span class="num">1</span>')
    expect(live).toBeGreaterThan(0)
  })

  it('drops a deleted goal from the ledger without leaking its kept check-ins into another goal\'s row', async () => {
    const kept = await createGoal(env.DB, {
      userId: 1, title: '保留的', cue: '', target: '', targetLabel: '', until: null, now: tsAt(addDays(TODAY, -4)),
    })
    const gone = await createGoal(env.DB, {
      userId: 1, title: '删掉的', cue: '', target: '', targetLabel: '', until: null, now: tsAt(addDays(TODAY, -4)),
    })
    await toggleCheckin(env.DB, 1, kept, TODAY, tsAt(TODAY))
    await toggleCheckin(env.DB, 1, gone, TODAY, tsAt(TODAY))
    await toggleCheckin(env.DB, 1, gone, addDays(TODAY, -2), tsAt(addDays(TODAY, -2)))

    // deleteGoal keeps check-in history (src/db.ts); this only removes the goal.
    expect(await deleteGoal(env.DB, 1, gone)).toBe(true)

    const main = mainOf(await render())
    expect(main).not.toContain('删掉的')
    expect(main.match(/<li><span class="gt">/g)).toHaveLength(1)

    const off = (cls: string) => `<i class="d${cls}"></i>`
    const keptRow =
      `<li><span class="gt">保留的</span><span class="dots" aria-label="最近七天">` +
      off('') + off('') + off('') + off('') + off('') + off('') + off(' on') +
      `</span><span class="rate num">5 天 · 打卡 1 天</span></li>`
    // If the deleted goal's day -2 check-in ever leaked onto this row, either
    // the -2 dot would be "on" or the rate would read 打卡 2 天 instead of 1.
    expect(main).toContain(keptRow)
  })

  it('stays calm: no 连续, no exclamation marks, and no <script> tag anywhere', async () => {
    await setupScenario()
    const html = await render()
    expect(html).not.toContain('连续')
    const main = mainOf(html)
    expect(main).not.toContain('!')
    expect(main).not.toContain('！')
    expect(html.toLowerCase()).not.toContain('<script')
  })
})
