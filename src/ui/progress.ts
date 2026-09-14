// /today/review — 「回看」. The counterpart to /review: that page is the
// interception ledger (did I hold?), this one is the goal-tending ledger (did
// I do the thing?). Nothing here is editable — /today/goals is where a goal
// changes; this page only looks back. Server-rendered, no JS, same shell as
// every other console page.
//
// Data rules, per the design doc
// (docs/plans/yixi/2026-09-13-today-face-and-review-design.md §2-3):
//
//   - "今天" is computed live, with the exact selection /today uses
//     (non-archived, not expired, first TODAY_GOAL_LIMIT) — there is no
//     midnight snapshot yet for a day that has not ended.
//   - The 30-day strip reads goal_days snapshots for every day except today,
//     which is always the live value, even overriding a stale/incorrect row
//     that happens to already exist for it — the cron (src/snapshot.ts) never
//     writes "today" in production, but a live override costs nothing and
//     means this page can never show yesterday's cron mistake as today's.
//   - Per-goal rows cover every non-archived goal, not only the three /today
//     shows — a goal folded into /today's "其余目标" still gets its own line
//     here, with a 30-day (or shorter, for a new goal) check-in rate.
//   - "这周" is the one number that is not a snapshot at all:
//     goal_task_checkins is queried directly, Monday (Asia/Shanghai) through
//     today, because a snapshot's "shown" set can no longer name a goal that
//     was later archived or deleted, but the sub-task checked under it still
//     happened this week. It counts check-ins, not tasks: the same sub-task
//     checked on Monday and again on Tuesday is two.
//
// CSS: CONSOLE_CSS (shared shell/nav/.card/.note/.num) plus PROGRESS_CSS
// below. This file does not import from review.ts — its CSS constant is not
// exported — but follows the same class idioms (card/hero/note/num) on
// purpose, so the two ledgers read as siblings rather than two designs.

import type { Env, Goal, User } from '../types'
import { countTaskCheckinsBetween, listCheckins, listGoalDays, listGoals, shanghaiDate } from '../db'
import { DEFAULT_THEME, escapeHtml, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { addDays, shownGoals } from '../dates'
import { localeOf, translator, type T } from '../i18n'

const DOTS = 7
const MONTH_DAYS = 30

export async function renderProgress(request: Request, env: Env, user: User): Promise<Response> {
  const loc = localeOf(request, user)
  const t = translator(loc)
  const now = Date.now()
  const today = shanghaiDate(now)
  const from = addDays(today, -(MONTH_DAYS - 1))
  const monday = mondayOf(today)

  const [goals, snapshotRows, checkins, weekTasksDone] = await Promise.all([
    listGoals(env.DB, user.id),
    listGoalDays(env.DB, user.id, from, today),
    listCheckins(env.DB, user.id, from, today),
    countTaskCheckinsBetween(env.DB, user.id, monday, today),
  ])

  const nonArchived = goals.filter((g) => g.archived_at === null)

  if (nonArchived.length === 0 && snapshotRows.length === 0) {
    return page({
      title: t('回看 · {name}', { name: user.name }),
      theme: DEFAULT_THEME,
      lang: loc,
      css: CONSOLE_CSS + PROGRESS_CSS,
      body: `${consoleHeader(user, 'progress', t)}\n<main>\n  <h1>${t('回看')}</h1>\n  ${emptyState(t)}\n</main>`,
    })
  }

  // Same selection /today renders: live (not expired), first TODAY_GOAL_LIMIT.
  const top = shownGoals(goals, today)
  const topIds = new Set(top.map((g) => g.id))

  const todayShown = top.length
  const todayDone = new Set(
    checkins.filter((c) => c.date === today && topIds.has(c.goal_id)).map((c) => c.goal_id),
  ).size

  const { bars, snapshotDays, fullDays } = monthStrip(today, snapshotRows, todayShown, todayDone)

  const checkinsByGoal = new Map<number, Set<string>>()
  for (const c of checkins) {
    let dates = checkinsByGoal.get(c.goal_id)
    if (!dates) {
      dates = new Set()
      checkinsByGoal.set(c.goal_id, dates)
    }
    dates.add(c.date)
  }
  const dotDays = Array.from({ length: DOTS }, (_, i) => addDays(today, i - (DOTS - 1)))
  // Per-goal rows cover every non-archived goal, expired or not — design §3.3:
  // an expired-but-not-archived goal's history is exactly what someone
  // deciding 续四周／归档 on /today/goals wants to see. Only the "今天" row
  // above (`top`/`shownGoals`) excludes expired goals; this list does not.
  const goalRows = nonArchived
    .map((g) => goalRowHtml(g, today, dotDays, checkinsByGoal.get(g.id) ?? new Set(), t))
    .join('')

  const body = `${consoleHeader(user, 'progress', t)}
<main>
  <h1>${t('回看')}</h1>
  <section class="card"><h2>${t('今天')}</h2><p class="hero"><b class="num">${todayDone}</b> / <span class="num">${todayShown}</span></p></section>
  <section class="card"><h2>${t('最近 {days} 天', { days: MONTH_DAYS })}</h2>
    <div class="strip" aria-label="${t('最近三十天每天的完成比例')}">${bars}</div>
    <p class="note">${t('{days} 天里有记录的 {n} 天，做完全部的 {full} 天。', { days: MONTH_DAYS, n: snapshotDays, full: fullDays })}</p>
  </section>
  <section class="card"><h2>${t('每个目标')}</h2>${goalRows === '' ? `<p class="note flat">${t('没有正在进行的目标。')}</p>` : `<ul class="gl">${goalRows}</ul>`}</section>
  <section class="card"><h2>${t('这周')}</h2><p>${t('做了 <b class="num">{n}</b> 次子任务。', { n: weekTasksDone })}</p></section>
  <p class="note">${t('拦截那边的记录在<a href="/review">回顾</a>。')}</p>
</main>`

  return page({
    title: t('回看 · {name}', { name: user.name }),
    theme: DEFAULT_THEME,
    lang: loc,
    css: CONSOLE_CSS + PROGRESS_CSS,
    body,
  })
}

// --- 30-day strip -----------------------------------------------------------

interface DaySnapshot {
  shown: number
  done: number
}

/**
 * Builds the 30 bars (today rightmost) and the two footnote counts in one
 * pass. Today is never read from `snapshotRows` — it is always the live
 * `(todayShown, todayDone)` pair, so a stray/incorrect stored row for today
 * can never leak into the strip.
 */
function monthStrip(
  today: string,
  snapshotRows: Array<{ date: string; shown: number; done: number }>,
  todayShown: number,
  todayDone: number,
): { bars: string; snapshotDays: number; fullDays: number } {
  const byDate = new Map<string, DaySnapshot>(snapshotRows.map((r) => [r.date, { shown: r.shown, done: r.done }]))
  byDate.set(today, { shown: todayShown, done: todayDone })

  const days = Array.from({ length: MONTH_DAYS }, (_, i) => addDays(today, i - (MONTH_DAYS - 1)))
  let snapshotDays = 0
  let fullDays = 0
  const bars = days
    .map((d) => {
      const row = byDate.get(d)
      if (!row) return '<i class="bar none"></i>'
      snapshotDays++
      if (row.shown === 0) return '<i class="bar zero"></i>'
      if (row.done === row.shown) fullDays++
      // Clamped: a corrupted snapshot row (done > shown, which should never
      // happen but costs nothing to guard) must not overflow the strip.
      return `<i class="bar" style="--h:${Math.min(1, row.done / row.shown).toFixed(2)}"></i>`
    })
    .join('')

  return { bars, snapshotDays, fullDays }
}

// --- per-goal row -------------------------------------------------------------

function goalRowHtml(g: Goal, today: string, dotDays: string[], checkedDates: Set<string>, t: T): string {
  const dots = dotDays.map((d) => `<i class="d${checkedDates.has(d) ? ' on' : ''}"></i>`).join('')
  const denom = Math.min(MONTH_DAYS, daysSinceInclusive(g.created_at, today))
  return `<li><span class="gt">${escapeHtml(g.title)}</span><span class="dots" aria-label="${t('最近七天')}">${dots}</span><span class="rate num">${t('{n} 天 · 打卡 {x} 天', { n: denom, x: checkedDates.size })}</span></li>`
}

/** Days from a goal's creation to `today`, both ends inclusive: created today = 1. */
function daysSinceInclusive(createdAt: number, today: string): number {
  const created = shanghaiDate(createdAt)
  const [y1, m1, d1] = created.split('-').map(Number) as [number, number, number]
  const [y2, m2, d2] = today.split('-').map(Number) as [number, number, number]
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1
}

/** The Monday (Asia/Shanghai) of the week containing `date`. */
function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sun … 6 = Sat
  return addDays(date, -((dow + 6) % 7))
}

function emptyState(t: T): string {
  return `<p class="empty">${t('还没有可以回看的。先去<a href="/today">今日</a>记下一件事。')}</p>`
}

// --- styles -------------------------------------------------------------------
//
// Appended to CONSOLE_CSS, which already carries .card/.note/.num/.empty —
// the idioms this page shares with /review. Only what neither CONSOLE_CSS nor
// any shared file defines is added here: the hero figure, the 30-bar strip,
// and the per-goal list/dots.
const PROGRESS_CSS = `
.hero{display:flex;align-items:baseline;gap:9px}
.hero b{font-size:44px;font-weight:600;line-height:1}
.hero span{font-size:20px;color:var(--dim)}
.strip{display:flex;align-items:flex-end;gap:3px;height:56px}
.bar{flex:1;min-width:0;border-radius:3px 3px 1px 1px;background:var(--ring-prog);
  height:calc(8px + var(--h,0) * 48px)}
/* A dashed slot, not a bar — design §3 calls the no-snapshot day 虚线空位,
   distinct from .zero's faint solid baseline (a day that did have a
   snapshot, just with nothing shown). */
.bar.none{height:6px;border-radius:0;background:none;border-top:1px dashed var(--ring-track)}
.bar.zero{height:4px;border-radius:1px;background:var(--ring-track)}
ul.gl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0}
ul.gl li{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--rule)}
ul.gl li:first-child{border-top:0;padding-top:0}
.gt{flex:1;min-width:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dots{display:flex;gap:6px;flex:none}
.dots .d{display:block;width:9px;height:9px;border-radius:50%;border:1px solid var(--ring-prog)}
.dots .d.on{background:var(--dot);border-color:var(--dot)}
.rate{flex:none;font-size:12.5px;color:var(--dim);white-space:nowrap}
`
