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

/**
 * 写完之后的回执，只发给我们自己的脚本：圆圈此刻亮不亮，今天该画的卡片是不是
 * 全勾了。两位都重新从库里读——界面已经被客户端先翻过去了，这里要给的是真相，
 * 不是它的猜测。allDone 跟 render 用同一个 shownGoals，免得两处各算各的。
 */
async function receipt(env: Env, user: User, goalId: number, date: string): Promise<Response> {
  const [goals, checkins] = await Promise.all([
    listGoals(env.DB, user.id),
    listCheckins(env.DB, user.id, date, date),
  ])
  const done = new Set(checkins.map((c) => c.goal_id))
  const shown = shownGoals(goals, date)
  const payload = {
    goal: { id: goalId, checked: done.has(goalId) },
    allDone: shown.length > 0 && shown.every((g) => done.has(g.id)),
  }
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
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
  // 只有页面里那段脚本会带这一位。没有它的请求——包括没有 JS 的表单提交——一个
  // 字节都不变，照旧 303 回 /today。同源由 SameSite cookie 与 CSP form-action
  // 'self' 管着，这一位只用来分辨「谁在问」，不是一道防线。
  const asJson = request.headers.get('x-yixi') === 'fetch'

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
      return asJson ? await receipt(env, user, id, date) : back()
    }
    // With sub-tasks the circle is a derived state, so the circle writes the
    // sub-tasks and lets the derivation put the goal's own row back. Writing
    // goal_checkins here as well would be the second source of truth this
    // whole change exists to remove.
    await setGoalTaskCheckins(env.DB, user.id, id, date, op === 'check', now)
    await syncGoalCheckin(env.DB, user.id, id, date, now)
    return asJson ? await receipt(env, user, id, date) : back()
  }
  if (op === 'task_check' || op === 'task_uncheck') {
    const id = intId(field(form, 'task'))
    if (id === null) return bad()
    const task = await getTask(env.DB, user.id, id)
    if (!task) return notFound()
    const date = shanghaiDate(now)
    await setTaskCheckin(env.DB, user.id, id, date, op === 'task_check', now)
    await syncGoalCheckin(env.DB, user.id, task.goal_id, date, now)
    // 一行勾完之后，回执说的是这一行所属目标的状态——圆圈亮不亮由它决定。
    return asJson ? await receipt(env, user, task.goal_id, date) : back()
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
  ${finHtml(allDone, t)}
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

/**
 * 一直在 DOM 里，没做完时带 hidden。最后一勾之后这句话要能立刻出现，而那一刻
 * 页面并不会重新渲染——脚本里又不许放文案，所以两句话必须先渲染好，客户端只
 * 碰 hidden 这一位。全勾时的字节与从前一模一样。
 */
function finHtml(allDone: boolean, t: T): string {
  return `<p class="fin"${allDone ? '' : ' hidden'}>${t('今天的事都做了。')}<span>${t('其余的事，明天再说。')}</span></p>`
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
  // aria-label 是此刻该念的那句；data-on/data-off 是翻面之后要换上的那两句。
  // 两句都渲染出来，脚本翻面时只搬属性——它一个字的文案都不带（layout.ts §copy）。
  const on = t('{title}，已打卡，点击取消', { title })
  const off = t('{title}，今天打卡', { title })
  return `<article class="${cls}" data-goal="${g.id}">
  <div class="head">
    <div class="tt"><h3>${title}</h3>${g.cue ? `<p class="cue">${escapeHtml(g.cue)}</p>` : ''}</div>
    <form method="post" action="/today" class="ckf">
      <input type="hidden" name="goal" value="${g.id}">
      <button class="ck" type="submit" name="op" value="${c.checked ? 'uncheck' : 'check'}" aria-label="${c.checked ? on : off}" data-on="${on}" data-off="${off}"><i></i></button>
    </form>
  </div>
  ${tasksHtml(c, t)}
  <div class="dots" aria-label="${t('最近七天')}">${c.dots.map((on) => `<i class="d${on ? ' on' : ''}"></i>`).join('')}</div>
  ${footHtml(c, t)}
</article>`
}

function tasksHtml(c: Card, t: T): string {
  if (c.tasks.length === 0) return ''
  return `<ul class="tks">${c.tasks.map((r) => taskRow(r, c.goal, t)).join('')}</ul>`
}

function taskRow(r: TaskRow, g: Goal, t: T): string {
  const title = escapeHtml(r.task.title)
  const on = t('{title}，已勾上，点击取消', { title })
  const off = t('{title}，今天勾上', { title })
  return `<li class="tkr${r.done ? ' done' : ''}">
    <form method="post" action="/today">
      <input type="hidden" name="task" value="${r.task.id}">
      <button class="tk" type="submit" name="op" value="${r.done ? 'task_uncheck' : 'task_check'}" aria-label="${r.done ? on : off}" data-on="${on}" data-off="${off}"><i></i></button>
    </form>
    <span class="tkt">${title}</span>${chipHtml(r, g, t)}
  </li>`
}

/**
 * 一行的跳转。沿用卡片底部按钮的三分法：空 → 不渲染；https → 新标签页链接；
 * 自定义 scheme → data-go 按钮，交给同一段同步的 location.href 脚本。
 *
 * 继承是成对的：一行没有自己的 target 时，target 与 label 一起取目标的——只借
 * scheme 不借 label，会把目标的 App 名安在一个跳去别处的行上。反过来，一行有
 * 自己的 target 却没填 label 时回落「去做」，同样不去借目标的名字。
 */
function chipHtml(r: TaskRow, g: Goal, t: T): string {
  const own = r.task.target !== ''
  const target = safeScheme(own ? r.task.target : g.target)
  if (target === '') return ''
  return jumpHtml('chip', target, jumpLabel(own ? r.task.target_label : g.target_label, t))
}

/**
 * 「去 B 站」／「去微信读书」／「去做」。
 *
 * 中西文之间留空，全中文不留。That spacing rule is Chinese typography, not a
 * translation, so it is two sources rather than a `{sep}` param — English maps
 * both to the same 「Open {label}」 and never has to reason about a separator it
 * does not want.
 */
function jumpLabel(rawLabel: string, t: T): string {
  if (rawLabel === '') return t('去做')
  const shown = escapeHtml(rawLabel)
  return /^[A-Za-z0-9]/.test(rawLabel) ? t('去 {label}', { label: shown }) : t('去{label}', { label: shown })
}

/**
 * 一处跳转的两种形态，行内 chip 与底部大按钮共用，只差一个类名：https 是普通
 * 的新标签页链接，自定义 scheme 是 data-go 按钮，交给那段同步的 location.href。
 * 入口契约：`target` 必须已经过 safeScheme，`label` 必须已经转义。
 */
function jumpHtml(cls: string, target: string, label: string): string {
  if (/^https?:/i.test(target)) {
    return `<a class="${cls}" href="${escapeHtml(target)}" target="_blank" rel="noopener">${icon('jump')}${label}</a>`
  }
  return `<button class="${cls}" type="button" data-go data-target="${escapeHtml(target)}">${icon('jump')}${label}</button>`
}

function bindHtml(g: Goal, t: T): string {
  return `<a class="bind linky" href="/today/goals#goal-${g.id}">${icon('jump')}${t('去绑一个 App，一按就开')}</a>`
}

function goHtml(g: Goal, t: T): string {
  const target = safeScheme(g.target)
  if (target === '') return bindHtml(g, t)
  return jumpHtml('go', target, jumpLabel(g.target_label, t))
}

/**
 * 卡片底部。没有子任务时还是原来那一个：能跳就是大按钮，不能跳就是去绑定的
 * 提示。有子任务时跳转已经在每一行上了，底部不再放按钮——唯一的例外是这张卡
 * 片一处都跳不了（目标没绑，子任务也全都没绑，或绑的被 safeScheme 拦下）：那
 * 时提示必须留着，否则卡片上再没有一条通向绑定页的路。判断跟渲染走同一个
 * sink，免得「绑了但绑的是 javascript:」既没有 chip 也没有提示。
 */
function footHtml(c: Card, t: T): string {
  if (c.tasks.length === 0) return goHtml(c.goal, t)
  const jumpable = safeScheme(c.goal.target) !== '' || c.tasks.some((r) => safeScheme(r.task.target) !== '')
  return jumpable ? '' : bindHtml(c.goal, t)
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
.tkt{flex:1;min-width:0;font-size:15px;line-height:1.5;overflow-wrap:anywhere}
.tkr.done .tkt{color:var(--faint)}
.tk{width:44px;height:44px;display:grid;place-items:center;margin-left:-8px}
.tk i{display:block;width:20px;height:20px;border-radius:50%;border:1.3px solid var(--ring-prog)}
.tkr.done .tk i{background:var(--dot);border-color:var(--dot)}
.chip{display:inline-flex;align-items:center;gap:5px;flex:none;min-height:44px;padding:0 10px;margin-right:-10px;
  border:0;background:none;color:var(--dim);font-size:13px;letter-spacing:.06em;text-decoration:none}
.chip:active{opacity:.72}
.chip .ic{width:13px;height:13px}
.tkr.done .chip{color:var(--faint)}
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
 * Four small jobs. The first is the hard rule.
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
 * submit: the check-in itself. A tap used to cost POST → 303 → GET, two round
 * trips to a colo an ocean away before anything moved. Now the page flips at
 * once and the request confirms in the background; the server answers the
 * marker header with the state it just wrote, and that answer — never the
 * client's guess — is what the circle, the seventh dot and the closing line
 * end up showing. Anything other than a 200 puts the optimistic flip back and
 * submits the form for real, so the user lands on the server's truth.
 *
 * This is a separate listener from the click one above on purpose: that one
 * owns a synchronous jump that must not grow a single deferred line, and
 * merging the two would put a fetch in the same function as CONTRIBUTING §2's
 * one rule. Without JS none of this exists and the forms post as they always
 * did.
 *
 * Three details in there that are not obvious from the code:
 *   - `.bloom` comes off in the same frame `.checked` goes on. The tap's ink is
 *     held by `.checked` from then on, and a page that no longer reloads
 *     between taps would otherwise hand the click handler above a button it
 *     has already decided to ignore.
 *   - `FormData` leaves the submitter out, so `op` — which IS the request — is
 *     put back on the body by hand, and again as a hidden field before the
 *     fall-back `form.submit()`, which drops it for the same reason.
 *   - the circle writes every sub-task row, so it flips every row, and the undo
 *     restores each row's own state rather than clearing them all: before the
 *     tap they need not have agreed.
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

function label(btn,on){
  var s=btn.getAttribute(on?'data-on':'data-off');
  if(s!==null)btn.setAttribute('aria-label',s);
}
function setRow(row,on){
  row.classList.toggle('done',on);
  var b=row.querySelector('button.tk');
  if(b){b.value=on?'task_uncheck':'task_check';label(b,on)}
}
function setCard(card,on){
  card.classList.toggle('checked',on);
  var b=card.querySelector('button.ck');
  if(b){b.value=on?'uncheck':'check';label(b,on);b.classList.remove('bloom')}
  var dots=card.querySelectorAll('.dots .d');
  var last=dots[dots.length-1];
  if(last)last.classList.toggle('on',on);
}

document.addEventListener('submit',function(e){
  var form=e.target;
  if(!form||!form.querySelector)return;
  var btn=form.querySelector('button.ck,button.tk');
  if(!btn)return;
  e.preventDefault();
  if(form.yxSending)return;
  var card=form.closest('article[data-goal]');
  if(!card)return;
  var op=btn.value,row=form.closest('li.tkr'),rows=card.querySelectorAll('li.tkr'),undo,i;
  if(row){
    var wasRow=row.classList.contains('done');
    setRow(row,!wasRow);
    undo=function(){setRow(row,wasRow)};
  }else{
    var wasCard=card.classList.contains('checked'),before=[];
    for(i=0;i<rows.length;i++)before.push(rows[i].classList.contains('done'));
    setCard(card,!wasCard);
    for(i=0;i<rows.length;i++)setRow(rows[i],!wasCard);
    undo=function(){
      setCard(card,wasCard);
      for(var k=0;k<rows.length;k++)setRow(rows[k],before[k]);
    };
  }
  var data=new URLSearchParams(new FormData(form));
  data.set(btn.name,op);
  form.yxSending=1;
  fetch('/today',{method:'POST',body:data,headers:{'x-yixi':'fetch'},credentials:'same-origin'})
    .then(function(r){if(!r.ok)throw new Error('http');return r.json()})
    .then(function(d){
      form.yxSending=0;
      if(!d||!d.goal||String(d.goal.id)!==card.getAttribute('data-goal'))throw new Error('elsewhere');
      setCard(card,d.goal.checked===true);
      var fin=document.querySelector('p.fin');
      if(fin)fin.hidden=d.allDone!==true;
    })
    .catch(function(){
      form.yxSending=0;
      undo();
      var h=document.createElement('input');
      h.type='hidden';h.name=btn.name;h.value=op;
      form.appendChild(h);
      form.submit();
    });
});

if(cfg.a2hs){
  var standalone=false,seen=false;
  try{standalone=window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches}catch(e){}
  try{seen=localStorage.getItem('yixi.a2hs')==='1'}catch(e){}
  var box=document.getElementById('a2hs');
  if(box&&!standalone&&!seen)box.hidden=false;
}
})();`
