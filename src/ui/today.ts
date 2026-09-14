// /today — the page you open every morning. Look, jump, tick. Nothing here is
// editable; that is /today/goals.
//
// Three things are deliberate:
//   1. Only the first TODAY_GOAL_LIMIT live goals get a card, and the first of
//      them is the hero. Fewer, with a clear first, is the point.
//   2. No streak number anywhere. Seven dots for the last seven days, empty
//      where nothing happened, and that is the whole statement.
//   3. The jump to a custom scheme is `location.href` inside the synchronous
//      click stack (CONTRIBUTING §2). https targets are ordinary new-tab links,
//      because navigating the standalone window itself would strand the user.

import type { Env, Goal, GoalTask, User } from '../types'
import { TODAY_GOAL_LIMIT } from '../types'
import {
  createGoal, getGoal, getTask, listCheckins, listGoals, listTaskCheckins, listTasks,
  setGoalTaskCheckins, setTaskCheckin, shanghaiDate, syncGoalCheckin, toggleCheckin,
} from '../db'
import { DEFAULT_THEME, escapeHtml, jsonScript, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { icon } from './icons'
import { inAppBrowserOf } from '../inapp'
import { safeScheme } from '../scheme'
import { addDays, liveGoals, prettyDate, shownGoals } from '../dates'
import { localeOf, translator, type Locale, type T } from '../i18n'

const DOTS = 7
const TITLE_MAX = 40

export async function handleToday(request: Request, env: Env, user: User): Promise<Response> {
  if (request.method === 'GET') {
    // One translator per request, built here and handed down — never a module
    // variable: a single isolate serves many requests at once.
    const loc = localeOf(request, user)
    return await render(request, env, user, loc, translator(loc))
  }
  if (request.method === 'POST') return await handlePost(request, env, user)
  return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST' } })
}

// --- POST ----------------------------------------------------------------------

function field(form: FormData, key: string): string {
  const v = form.get(key)
  return typeof v === 'string' ? v.trim() : ''
}
function intId(raw: string): number | null {
  return /^\d{1,12}$/.test(raw) ? Number(raw) : null
}
function back(): Response {
  return new Response(null, { status: 303, headers: { location: '/today', 'cache-control': 'no-store' } })
}
function bad(): Response {
  return new Response('bad request', { status: 400 })
}
function notFound(): Response {
  return new Response('not found', { status: 404 })
}

async function handlePost(request: Request, env: Env, user: User): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return bad()
  }
  const op = field(form, 'op')
  const now = Date.now()

  if (op === 'quick_add') {
    const title = field(form, 'title')
    if (title.length === 0 || title.length > TITLE_MAX) return bad()
    await createGoal(env.DB, { userId: user.id, title, cue: '', target: '', targetLabel: '', until: null, now })
    return back()
  }
  if (op === 'check' || op === 'uncheck') {
    const id = intId(field(form, 'goal'))
    if (id === null) return bad()
    const date = shanghaiDate(now)
    const goal = await getGoal(env.DB, user.id, id)
    if (!goal) return notFound()
    const hasTasks = (await listTasks(env.DB, user.id)).some((tk) => tk.goal_id === id)
    if (!hasTasks) {
      // toggle is by day; `check` and `uncheck` are the same request and only
      // differ in what the button said, so a double tap cannot double count.
      await toggleCheckin(env.DB, user.id, id, date, now)
      return back()
    }
    // With sub-tasks the circle is a derived state, so the circle writes the
    // sub-tasks and lets the derivation put the goal's own row back. Writing
    // goal_checkins here as well would be the second source of truth this
    // whole change exists to remove.
    await setGoalTaskCheckins(env.DB, user.id, id, date, op === 'check', now)
    await syncGoalCheckin(env.DB, user.id, id, date, now)
    return back()
  }
  if (op === 'task_check' || op === 'task_uncheck') {
    const id = intId(field(form, 'task'))
    if (id === null) return bad()
    const task = await getTask(env.DB, user.id, id)
    if (!task) return notFound()
    const date = shanghaiDate(now)
    await setTaskCheckin(env.DB, user.id, id, date, op === 'task_check', now)
    await syncGoalCheckin(env.DB, user.id, task.goal_id, date, now)
    return back()
  }
  return bad()
}

// --- GET -------------------------------------------------------------------------

/** 一条子任务在今日卡片上的样子：它自己，加上「今天勾了没有」。 */
interface TaskRow {
  task: GoalTask
  done: boolean
}

interface Card {
  goal: Goal
  hero: boolean
  checked: boolean
  tasks: TaskRow[]
  dots: boolean[]
}

async function render(request: Request, env: Env, user: User, loc: Locale, t: T): Promise<Response> {
  const now = Date.now()
  const today = shanghaiDate(now)
  const days = Array.from({ length: DOTS }, (_, i) => addDays(today, i - (DOTS - 1)))
  const [goals, tasks, checkins, taskCheckins] = await Promise.all([
    listGoals(env.DB, user.id),
    listTasks(env.DB, user.id),
    listCheckins(env.DB, user.id, days[0]!, today),
    listTaskCheckins(env.DB, user.id, today, today),
  ])
  const live = liveGoals(goals, today)
  const top = shownGoals(goals, today)
  const rest = live.slice(TODAY_GOAL_LIMIT)
  const checked = new Set(checkins.map((c) => `${c.goal_id}:${c.date}`))
  const doneTasks = new Set(taskCheckins.map((c) => c.task_id))

  const cards: Card[] = top.map((g, i) => ({
    goal: g,
    hero: i === 0,
    // 有子任务时这一位仍然读 goal_checkins：syncGoalCheckin 已经保证它等于
    // 「今天所有子任务都勾了」，所以圆点、七日点、沉底逻辑一个都不用改。
    checked: checked.has(`${g.id}:${today}`),
    tasks: tasks.filter((tk) => tk.goal_id === g.id).map((task) => ({ task, done: doneTasks.has(task.id) })),
    dots: days.map((d) => checked.has(`${g.id}:${d}`)),
  }))
  // Checked cards sink; order inside each half is preserved.
  const ordered = [...cards.filter((c) => !c.checked), ...cards.filter((c) => c.checked)]
  const allDone = cards.length > 0 && cards.every((c) => c.checked)

  const ua = request.headers.get('user-agent') ?? ''
  const iphoneSafari = /iPhone/.test(ua) && /Safari/.test(ua) && inAppBrowserOf(request) === null

  const body = `${consoleHeader(user, 'today', t)}
<main>
  <div class="dayline"><span class="num">${escapeHtml(prettyDate(today, loc))}</span><span class="dlinks"><a class="linky" href="/today/review">${t('回看')}</a><a class="linky" href="/today/goals">${t('编辑目标')}</a></span></div>
  ${live.length === 0 ? emptyState(t) : ordered.map((c) => cardHtml(c, t)).join('\n')}
  ${allDone ? `<p class="fin">${t('今天的事都做了。')}<span>${t('其余的事，明天再说。')}</span></p>` : ''}
  ${rest.length ? restFold(rest, t) : ''}
  ${iphoneSafari ? banner(t) : ''}
</main>
${jsonScript('cfg', { a2hs: iphoneSafari })}`

  return page({
    title: t('今日 · 一息'),
    theme: DEFAULT_THEME,
    lang: loc,
    css: CONSOLE_CSS + TODAY_CSS,
    body,
    script: TODAY_JS,
  })
}

function emptyState(t: T): string {
  return `<form class="card quick" method="post" action="/today">
  <p class="q1">${t('先写一件最重要的事。')}</p>
  <div class="row">
    <input type="text" name="title" placeholder="${t('健身')}" maxlength="${TITLE_MAX}" required aria-label="${t('新目标')}">
    <button class="primary" type="submit" name="op" value="quick_add">${t('记下')}</button>
  </div>
</form>`
}

function cardHtml(c: Card, t: T): string {
  const g = c.goal
  const cls = `card goal${c.hero ? ' hero' : ''}${c.checked ? ' checked' : ''}`
  const title = escapeHtml(g.title)
  return `<article class="${cls}" data-goal="${g.id}">
  <div class="head">
    <div class="tt"><h3>${title}</h3>${g.cue ? `<p class="cue">${escapeHtml(g.cue)}</p>` : ''}</div>
    <form method="post" action="/today" class="ckf">
      <input type="hidden" name="goal" value="${g.id}">
      <button class="ck" type="submit" name="op" value="${c.checked ? 'uncheck' : 'check'}" aria-label="${c.checked ? t('{title}，已打卡，点击取消', { title }) : t('{title}，今天打卡', { title })}"><i></i></button>
    </form>
  </div>
  ${tasksHtml(c, t)}
  <div class="dots" aria-label="${t('最近七天')}">${c.dots.map((on) => `<i class="d${on ? ' on' : ''}"></i>`).join('')}</div>
  ${goHtml(g, t)}
</article>`
}

function tasksHtml(c: Card, t: T): string {
  if (c.tasks.length === 0) return ''
  return `<ul class="tks">${c.tasks.map((r) => taskRow(r, c.goal, t)).join('')}</ul>`
}

function taskRow(r: TaskRow, _goal: Goal, t: T): string {
  const title = escapeHtml(r.task.title)
  return `<li class="tkr${r.done ? ' done' : ''}">
    <form method="post" action="/today">
      <input type="hidden" name="task" value="${r.task.id}">
      <button class="tk" type="submit" name="op" value="${r.done ? 'task_uncheck' : 'task_check'}" aria-label="${r.done ? t('{title}，已勾上，点击取消', { title }) : t('{title}，今天勾上', { title })}"><i></i></button>
    </form>
    <span class="tkt">${title}</span>
  </li>`
}

function goHtml(g: Goal, t: T): string {
  const target = safeScheme(g.target)
  // 中西文之间留空，全中文不留：「去 B 站」但「去微信读书」。That spacing rule is
  // Chinese typography, not a translation, so it is two sources rather than a
  // `{sep}` param — English maps both to the same 「Open {label}」 and never
  // has to reason about a separator it does not want.
  const shown = escapeHtml(g.target_label)
  const label = g.target_label
    ? (/^[A-Za-z0-9]/.test(g.target_label) ? t('去 {label}', { label: shown }) : t('去{label}', { label: shown }))
    : t('去做')
  if (target === '') {
    return `<a class="bind linky" href="/today/goals#goal-${g.id}">${icon('jump')}${t('去绑一个 App，一按就开')}</a>`
  }
  if (/^https?:/i.test(target)) {
    return `<a class="go" href="${escapeHtml(target)}" target="_blank" rel="noopener">${icon('jump')}${label}</a>`
  }
  return `<button class="go" type="button" data-go data-target="${escapeHtml(target)}">${icon('jump')}${label}</button>`
}

function restFold(goals: Goal[], t: T): string {
  return `<details class="rest">
  <summary>${icon('chev', { cls: 'chev' })}${t('其余目标 · {n}', { n: goals.length })}</summary>
  <ul>${goals.map((g) => `<li><a href="/today/goals#goal-${g.id}">${escapeHtml(g.title)}</a></li>`).join('')}</ul>
</details>`
}

function banner(t: T): string {
  return `<aside class="a2hs" id="a2hs" hidden>
  <p>${t('<b>添加到主屏幕</b>，以后一按就开。Safari 底部「分享」→「添加到主屏幕」。装好后第一次打开要再登录一次。')}</p>
  <button type="button" class="linky" id="a2hs-x">${t('知道了')}</button>
</aside>`
}

const TODAY_CSS = `
.dayline{display:flex;align-items:baseline;justify-content:space-between;margin:6px 0 16px;color:var(--dim);font-size:14px;letter-spacing:.08em}
.dayline .dlinks{display:flex;gap:14px}
.dayline .dlinks a{padding:12px 0;margin:-12px 0;display:inline-block}
.goal{position:relative;padding:18px 18px 16px}
.goal.hero{padding:26px 20px 20px}
.goal .head{display:flex;align-items:flex-start;gap:12px}
.goal .tt{flex:1;min-width:0}
.goal h3{margin:0;font-size:19px;font-weight:600;line-height:1.4}
.goal.hero h3{font-size:26px}
.goal .cue{margin:3px 0 0;font-size:13px;color:var(--dim);letter-spacing:.08em}
.goal.checked{opacity:.72}
.goal.checked h3{color:var(--dim)}
.ckf{margin:0;flex:none}
.ck{width:44px;height:44px;display:grid;place-items:center;border-radius:50%}
.ck i{display:block;width:26px;height:26px;border-radius:50%;border:1.3px solid var(--ring-prog);position:relative}
.ck i::after{content:"";position:absolute;inset:4px;border-radius:50%;background:var(--dot);transform:scale(0);opacity:0}
.goal.checked .ck i::after,.ck.bloom i::after{transform:scale(1);opacity:1}
.ck.bloom i::after{transition:transform .26s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
.tks{list-style:none;margin:14px 0 0;padding:0}
.tkr{display:flex;align-items:center;gap:8px;min-height:44px}
.tkr form{margin:0;flex:none}
.tkt{flex:1;min-width:0;font-size:15px;line-height:1.5}
.tkr.done .tkt{color:var(--faint)}
.tk{width:44px;height:44px;display:grid;place-items:center;margin-left:-8px}
.tk i{display:block;width:20px;height:20px;border-radius:50%;border:1.3px solid var(--ring-prog)}
.tkr.done .tk i{background:var(--dot);border-color:var(--dot)}
.dots{display:flex;gap:8px;margin:16px 0 0}
.dots .d{display:block;width:9px;height:9px;border-radius:50%;border:1px solid var(--ring-prog)}
.dots .d.on{background:var(--dot);border-color:var(--dot)}
.go{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin:16px 0 0;
  min-height:48px;border-radius:12px;background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  font-size:16px;letter-spacing:.12em;text-decoration:none}
.go:active{opacity:.72}
.go .ic{width:16px;height:16px}
.bind{display:inline-flex;align-items:center;gap:6px;margin:14px 0 0;text-decoration:underline;text-underline-offset:3px}
.fin{margin:22px 0 8px;text-align:center;color:var(--fg);letter-spacing:.12em;line-height:2}
.fin span{display:block;font-size:13px;color:var(--faint)}
.quick .q1{margin:0 0 12px;font-size:17px}
.quick .row{align-items:stretch}
.quick input{flex:1;min-width:0;font:inherit;font-size:16px;padding:10px 12px;color:var(--fg);background:transparent;border:1px solid var(--rule);border-radius:10px}
details.rest{margin:18px 0 0}
details.rest ul{list-style:none;margin:8px 0 0;padding:0}
details.rest li{padding:6px 0;font-size:15px;color:var(--dim)}
details.rest li a{text-decoration:none}
.a2hs{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));
  border:1px solid var(--rule);border-radius:14px;padding:12px 14px;background:var(--bg);
  display:flex;gap:12px;align-items:center;font-size:13px;line-height:1.7;color:var(--dim);box-shadow:0 6px 24px rgba(0,0,0,.08)}
.a2hs p{margin:0;flex:1}
.a2hs b{color:var(--fg)}
@media (prefers-reduced-motion:reduce){.ck.bloom i::after{transition:none}}
`

/**
 * Three small jobs. The first is the hard rule.
 *
 * go(): location.href to a custom scheme inside the click's synchronous stack.
 * Nothing awaited, nothing deferred, before the assignment. CONTRIBUTING §2.
 *
 * bloom: a check tap paints the dot immediately, then submits the form after
 * the 260ms transition, so the 303 lands on a page that already looks the way
 * the tap did. Without JS the form submits normally. A second tap while the
 * button still carries `.bloom` is a no-op — nothing re-arms the timer or
 * resubmits — or a fast double tap would fire check, then uncheck.
 *
 * a2hs: the banner is server-rendered hidden for iPhone Safari; the client
 * shows it only outside standalone mode and only until dismissed.
 */
const TODAY_JS = `(function(){
var cfg=JSON.parse(document.getElementById('cfg').textContent);

function go(el){
  location.href = el.getAttribute('data-target'); // synchronous, same gesture stack. Nothing may be deferred above this line.
}

var calm=false;
try{calm=window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}

document.addEventListener('click',function(e){
  var t=e.target;
  if(!t||!t.closest)return;
  var g=t.closest('[data-go]');
  if(g){go(g);return}
  var ck=t.closest('button.ck');
  if(ck&&ck.value==='check'&&!calm){
    var form=ck.closest('form');
    if(!form||!form.requestSubmit)return;
    e.preventDefault();
    if(ck.classList.contains('bloom'))return;
    ck.classList.add('bloom');
    setTimeout(function(){form.requestSubmit(ck)},260);
    return;
  }
  if(t.closest('#a2hs-x')){
    var a=document.getElementById('a2hs');
    if(a)a.hidden=true;
    try{localStorage.setItem('yixi.a2hs','1')}catch(e){}
  }
});

if(cfg.a2hs){
  var standalone=false,seen=false;
  try{standalone=window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches}catch(e){}
  try{seen=localStorage.getItem('yixi.a2hs')==='1'}catch(e){}
  var box=document.getElementById('a2hs');
  if(box&&!standalone&&!seen)box.hidden=false;
}
})();`
