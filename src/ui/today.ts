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
import { createGoal, listCheckins, listGoals, listTasks, setTaskDone, shanghaiDate, toggleCheckin } from '../db'
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
    // toggle is by day; `check` and `uncheck` are the same request and only
    // differ in what the button said, so a double tap cannot double count.
    const r = await toggleCheckin(env.DB, user.id, id, shanghaiDate(now), now)
    return r === 'nogoal' ? notFound() : back()
  }
  if (op === 'task_done' || op === 'task_undo') {
    const id = intId(field(form, 'task'))
    if (id === null) return bad()
    const ok = await setTaskDone(env.DB, user.id, id, op === 'task_done' ? now : null)
    return ok ? back() : notFound()
  }
  return bad()
}

// --- GET -------------------------------------------------------------------------

interface Card {
  goal: Goal
  hero: boolean
  checked: boolean
  next: GoalTask | null
  moreUndone: number
  doneToday: GoalTask[]
  dots: boolean[]
}

async function render(request: Request, env: Env, user: User, loc: Locale, t: T): Promise<Response> {
  const now = Date.now()
  const today = shanghaiDate(now)
  const days = Array.from({ length: DOTS }, (_, i) => addDays(today, i - (DOTS - 1)))
  const [goals, tasks, checkins] = await Promise.all([
    listGoals(env.DB, user.id),
    listTasks(env.DB, user.id),
    listCheckins(env.DB, user.id, days[0]!, today),
  ])
  const live = liveGoals(goals, today)
  const top = shownGoals(goals, today)
  const rest = live.slice(TODAY_GOAL_LIMIT)
  const checked = new Set(checkins.map((c) => `${c.goal_id}:${c.date}`))

  const cards: Card[] = top.map((g, i) => {
    const mine = tasks.filter((t) => t.goal_id === g.id)
    const undone = mine.filter((t) => t.done_at === null)
    return {
      goal: g,
      hero: i === 0,
      checked: checked.has(`${g.id}:${today}`),
      next: undone[0] ?? null,
      moreUndone: Math.max(0, undone.length - 1),
      doneToday: mine.filter((t) => t.done_at !== null && shanghaiDate(t.done_at) === today),
      dots: days.map((d) => checked.has(`${g.id}:${d}`)),
    }
  })
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
    <input type="text" name="title" placeholder="${t('健身')}" maxlength="${TITLE_MAX}" required aria-label="${t('目标')}">
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
  ${nextHtml(c, t)}
  <div class="dots" aria-label="${t('最近七天')}">${c.dots.map((on) => `<i class="d${on ? ' on' : ''}"></i>`).join('')}</div>
  ${goHtml(g, t)}
</article>`
}

function nextHtml(c: Card, t: T): string {
  const doneList = c.doneToday
    .map((task) => `<li class="done today"><span>${escapeHtml(task.title)}</span>
      <form method="post" action="/today"><input type="hidden" name="task" value="${task.id}"><button class="linky" type="submit" name="op" value="task_undo">${t('撤销')}</button></form></li>`)
    .join('')
  if (!c.next && doneList === '') return ''
  const next = c.next
    ? `<form method="post" action="/today" class="next">
    <input type="hidden" name="task" value="${c.next.id}">
    <button class="tk" type="submit" name="op" value="task_done" aria-label="${t('完成：{title}', { title: escapeHtml(c.next.title) })}"><i></i></button>
    <span class="nl">${t('下一步')}</span><span class="nt">${escapeHtml(c.next.title)}</span>
  </form>`
    : ''
  const more = c.moreUndone > 0
    ? `<p class="more">${t('还有 {n} 条，去<a href="/today/goals#goal-{id}">目标</a>里看。', { n: c.moreUndone, id: c.goal.id })}</p>`
    : ''
  return `${next}${more}${doneList ? `<ul class="donel">${doneList}</ul>` : ''}`
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
.next{display:flex;align-items:center;gap:10px;margin:14px 0 0}
.tk{width:44px;height:44px;display:grid;place-items:center;margin-left:-8px}
.tk i{display:block;width:22px;height:22px;border-radius:6px;border:1.3px solid var(--ring-prog)}
.nl{font-size:12px;color:var(--faint);letter-spacing:.1em;flex:none}
.nt{font-size:15px;flex:1;min-width:0}
.more{margin:6px 0 0 30px;font-size:13px;color:var(--faint)}
.more a{color:var(--dim)}
.donel{list-style:none;margin:8px 0 0 30px;padding:0}
.donel li{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--faint);text-decoration:line-through}
.donel li form{margin:0}
.donel button.linky{padding:11px 0;font-size:12px;text-decoration:none}
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
