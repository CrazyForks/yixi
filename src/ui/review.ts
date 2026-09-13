// /review — the honest ledger.
//
// Ordered by what the reader actually came for: today first (did I hold?), then
// the last seven days (am I getting better or worse?), then which app is eating
// me, then a 30-day backdrop. Server-rendered, CSS inline, no JS at all — this
// page is opened on a phone, often on a bad connection, in the two seconds of
// self-doubt after putting it down.
//
// Honesty rules baked into the markup:
//   - grace_pass never enters a number; it appears once, as a footnote, so the
//     exclusion is visible rather than invisible.
//   - 「没做选择」(opened the breathing page, swiped away) is its own third
//     number. Those sessions did not enter the app, but they were not a
//     deliberate 「算了」either, and folding them into the abandon side would
//     flatter the reader with a rate they did not earn.
//   - A user with no data sees a welcome, not a wall of zeroes and NaN.

import type { Env, User } from '../types'
import {
  MONTH_DAYS,
  WEEK_DAYS,
  getReviewStats,
  type AppStat,
  type Counts,
  type DayStat,
  type ReviewStats,
} from '../stats'
import { DEFAULT_THEME, escapeHtml, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { monthDay, shortWeekday } from '../dates'
import { localeOf, translator, type Locale, type T } from '../i18n'

export async function renderReview(
  // Read for its language only; this page takes no query parameters, and
  // `request` is part of the route handler contract in src/index.ts.
  request: Request,
  env: Env,
  user: User,
): Promise<Response> {
  // One translator per request, built here and handed down — never a module
  // variable: a single isolate serves many requests at once.
  const loc = localeOf(request, user)
  const t = translator(loc)
  const stats = await getReviewStats(env.DB, user.id)
  return page({
    title: t('回顾 · {name}', { name: user.name }),
    theme: DEFAULT_THEME,
    lang: loc,
    css: CONSOLE_CSS + CSS,
    body: consoleHeader(user, 'review', t) + '<main>' + (stats.firstDate === null ? emptyState(t) : sections(stats, loc, t)) + '</main>',
  })
}

// --- sections -------------------------------------------------------------

function sections(s: ReviewStats, loc: Locale, t: T): string {
  return [todaySection(s, loc, t), weekSection(s, loc, t), appsSection(s, t), monthSection(s, t), footnote(s, t)].join('\n')
}

// 1. Today: how many times was I stopped, how many did I hold.
function todaySection(s: ReviewStats, loc: Locale, t: T): string {
  const c = s.todayCounts
  if (c.attempts === 0) {
    return card(
      t('今天'),
      `<p class="quiet">${t('今天还没有被拦下过。')}</p>
  <p class="note">${escapeHtml(monthDay(s.today, loc))}</p>`,
    )
  }
  return card(
    t('今天'),
    `<p class="hero"><b class="num">${c.attempts}</b><span>${t('次拦下')}</span></p>
  <div class="split">${splitBar(c)}</div>
  <ul class="legend">
    <li><i class="sw hold"></i>${t('忍住')} <b class="num">${c.abandoned}</b></li>
    <li><i class="sw idle"></i>${t('没做选择')} <b class="num">${c.undecided}</b></li>
    <li><i class="sw go"></i>${t('进去了')} <b class="num">${c.proceeded}</b></li>
  </ul>
  <p class="note">${t('「忍住」是明确点了「算了」；「没做选择」是开了呼吸页直接切走——同样没进 App，但不算你主动放弃，所以分开记。')}</p>`,
  )
}

// 2. Last 7 days: one bar per day, split by outcome, plus the window's rate.
function weekSection(s: ReviewStats, loc: Locale, t: T): string {
  const peak = Math.max(1, ...s.week.map(d => d.attempts))
  const cols = s.week.map(d => dayColumn(d, peak, d.date === s.today, loc, t)).join('')
  const week = s.weekTotals
  const summary =
    week.attempts === 0
      ? `<p class="quiet">${t('这七天一次都没被拦下。')}</p>`
      : `<p class="sub">${t('共 <b class="num">{n}</b> 次拦下，忍住 <b class="num">{hold}</b> 次，放弃率 <b class="num">{rate}</b>。', { n: week.attempts, hold: week.abandoned, rate: pct(week.abandonRate) })}</p>`
  return card(t('最近 {days} 天', { days: WEEK_DAYS }), `${summary}\n  <div class="chart">${cols}</div>`)
}

function dayColumn(d: DayStat, peak: number, isToday: boolean, loc: Locale, t: T): string {
  const label = isToday ? t('今天') : shortWeekday(d.date, loc)
  const title = t('{date}：拦下 {n} 次，忍住 {hold}，没做选择 {idle}，进去了 {go}', {
    date: d.date, n: d.attempts, hold: d.abandoned, idle: d.undecided, go: d.proceeded,
  })
  // A day with one attempt against a peak of thirty still has to be visible, so
  // the height is floored rather than left proportional all the way to zero.
  const bar =
    d.attempts === 0
      ? '<div class="bar none"></div>'
      : `<div class="bar" style="height:${Math.max(8, Math.round((d.attempts / peak) * 100))}%">` +
        seg('go', d.proceeded) +
        seg('idle', d.undecided) +
        seg('hold', d.abandoned) +
        '</div>'
  return `<div class="col${isToday ? ' now' : ''}" title="${escapeHtml(title)}">
  <span class="n num${d.attempts === 0 ? ' zero' : ''}">${d.attempts}</span>
  <div class="plot">${bar}</div>
  <span class="d">${escapeHtml(label)}</span>
</div>`
}

// 3. Which app costs you the most.
function appsSection(s: ReviewStats, t: T): string {
  if (s.apps.length === 0) {
    return card(t('哪个 App 最消耗你'), `<p class="quiet">${t('这 {days} 天还没有记录。', { days: MONTH_DAYS })}</p>`)
  }
  const peak = Math.max(1, ...s.apps.map(a => a.attempts))
  return card(
    t('哪个 App 最消耗你'),
    `<p class="sub">${t('最近 {days} 天，按拦下次数排。', { days: MONTH_DAYS })}</p>
  <ol class="apps">${s.apps.map(a => appRow(a, peak, t)).join('')}</ol>`,
  )
}

function appRow(a: AppStat, peak: number, t: T): string {
  return `<li>
  <div class="line">
    <span class="name">${escapeHtml(a.label)}</span>
    <span class="cnt">${t('<b class="num">{n}</b> 次', { n: a.attempts })}</span>
  </div>
  <div class="track"><span class="fill" style="width:${Math.max(2, Math.round((a.attempts / peak) * 100))}%">${splitBar(a)}</span></div>
  <div class="line sub2">
    <span>${t('忍住 {hold} · 没做选择 {idle} · 进去了 {go}', { hold: a.abandoned, idle: a.undecided, go: a.proceeded })}</span>
    <span class="rate num">${t('放弃率 {rate}', { rate: pct(a.abandonRate) })}</span>
  </div>
</li>`
}

// 4. The 30-day backdrop.
function monthSection(s: ReviewStats, t: T): string {
  const month = s.monthTotals
  const tail =
    month.attempts > 0
      ? `<p class="note">${t('其中 {idle} 次开了呼吸页但没做选择，{go} 次撑过等待还是进去了。', { idle: month.undecided, go: month.proceeded })}</p>`
      : `<p class="quiet">${t('这 {days} 天没有记录。', { days: MONTH_DAYS })}</p>`
  return card(
    t('最近 {days} 天', { days: MONTH_DAYS }),
    `<div class="tiles">
    ${tile(String(month.attempts), t('次拦下'))}
    ${tile(String(month.abandoned), t('次忍住'))}
    ${tile(pct(month.abandonRate), t('放弃率'))}
    ${tile(`${s.monthActiveDays}/${MONTH_DAYS}`, t('有记录的天'))}
  </div>
  ${tail}`,
  )
}

function footnote(s: ReviewStats, t: T): string {
  const parts: string[] = []
  if (s.firstDate) parts.push(t('记录始于 {date}。', { date: escapeHtml(s.firstDate) }))
  if (s.monthGracePasses > 0) {
    parts.push(
      t('另有 {n} 次是点「继续」跳回 App 时自动化重复触发的，属于机器噪音，未计入以上任何数字。', { n: s.monthGracePasses }),
    )
  }
  parts.push(t('这页只有你能看到。'))
  return `<p class="foot">${parts.join(' ')}</p>`
}

function emptyState(t: T): string {
  return card(
    t('还没有记录'),
    `<p class="quiet">${t('你还没有被拦下过一次。')}</p>
  <p class="note">${t('先去 <a href="/settings">设置</a> 添加要拦的 App，再在 iPhone「快捷指令」里为它建一条「打开 App 时」自动化。之后每一次冲动都会记在这里。')}</p>`,
  )
}

// --- pieces ---------------------------------------------------------------

function card(heading: string, inner: string): string {
  return `<section class="card">
  <h2>${escapeHtml(heading)}</h2>
  ${inner}
</section>`
}

function tile(value: string, label: string): string {
  return `<div class="tile"><b class="num">${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`
}

/** Proportional hold / undecided / proceeded segments; zero-count ones vanish. */
function splitBar(c: Counts): string {
  return seg('hold', c.abandoned) + seg('idle', c.undecided) + seg('go', c.proceeded)
}

// flex-grow carries the proportion, so there is no percentage arithmetic and no
// rounding drift leaving a 1px gap at the end of the bar.
function seg(cls: string, n: number): string {
  return n > 0 ? `<span class="seg ${cls}" style="flex:${n}"></span>` : ''
}

/** A rate as a whole percent; an em dash when there is no denominator. */
function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

// --- styles ---------------------------------------------------------------
//
// Appended to CONSOLE_CSS, which carries the shell, the nav and the type
// scale this page shares with /settings, /setup and /account. What is
// added here is only what the other pages have no use for: the outcome hues,
// and the chart/tile geometry. `--num` (a UI font for figures, since 宋体
// digits are proportional and hard to scan in a column of counts) also comes
// from CONSOLE_CSS now.
const CSS = `
:root{
  --hold:#2f7d57; --idle:rgba(31,28,24,.28); --go:#a8543c;
}
@media (prefers-color-scheme:dark){
  :root{ --hold:#4faa80; --idle:rgba(238,235,228,.26); --go:#c9795c; }
}
/* Three narrow overrides on the shared chrome. This page stacks self-contained
   blocks rather than running prose, so a paragraph carries no bottom margin,
   and its section headings and footnotes sit slightly further from what they
   label. Everything else — shell, nav, cards, type scale — comes from
   CONSOLE_CSS, because /review having its own copy is what let its nav drift
   into a different, smaller, three-tab thing nobody could get back out of. */
p{margin:0}
h2{margin:0 0 12px}
.note{margin-top:14px}
.sub{font-size:14px;color:var(--dim);margin-bottom:14px}
.quiet{font-size:15px;color:var(--dim)}
.hero{display:flex;align-items:baseline;gap:9px;margin-bottom:14px}
.hero b{font-size:44px;font-weight:600;line-height:1}
.hero span{font-size:14px;color:var(--dim)}
.split{height:10px;border-radius:99px;overflow:hidden;background:var(--ring-track);display:flex}
.seg{display:block}
.seg.hold{background:var(--hold)}
.seg.idle{background:var(--idle)}
.seg.go{background:var(--go)}
ul.legend{list-style:none;display:flex;flex-wrap:wrap;gap:16px;margin:13px 0 0;padding:0;font-size:14px;color:var(--dim)}
ul.legend b{color:var(--fg)}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
.sw.hold{background:var(--hold)}.sw.idle{background:var(--idle)}.sw.go{background:var(--go)}
.chart{display:flex;align-items:flex-end;gap:6px}
.col{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0}
.col .n{font-size:12.5px;color:var(--dim);line-height:1}
.col .n.zero{color:var(--faint);opacity:.55}
.col .d{font-size:12.5px;color:var(--faint);white-space:nowrap;line-height:1}
.col.now .d{color:var(--fg)}
.plot{width:100%;height:92px;display:flex;align-items:flex-end}
.bar{width:100%;border-radius:5px;overflow:hidden;display:flex;flex-direction:column;min-height:4px}
.bar.none{height:3px;background:var(--ring-track);border-radius:2px}
ol.apps{list-style:none;margin:0;padding:0}
ol.apps li{padding:14px 0;border-top:1px solid var(--rule)}
ol.apps li:first-child{border-top:0;padding-top:0}
.line{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.line.sub2{margin-top:7px;font-size:13px;color:var(--faint)}
.name{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cnt{font-size:13px;color:var(--dim);white-space:nowrap}
.cnt b{font-size:19px;color:var(--fg)}
.rate{white-space:nowrap}
.track{margin-top:9px;height:9px;background:var(--ring-track);border-radius:99px;overflow:hidden}
.fill{display:flex;height:100%;border-radius:99px;overflow:hidden}
.tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.tile{border:1px solid var(--rule);border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:3px}
.tile b{font-size:25px;font-weight:600;line-height:1.1}
.tile span{font-size:12.5px;color:var(--faint)}
.foot{font-size:13px;line-height:1.9;color:var(--faint);padding:4px 2px 0}
@media (min-width:430px){.tiles{grid-template-columns:repeat(4,1fr)}}
`

