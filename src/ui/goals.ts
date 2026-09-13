// /today/goals — the planning page behind /today. (The old bare /goals now
// 302s here — see src/index.ts.)
//
// /today is for doing and shows nothing editable; everything about a goal is
// changed here. Same shape as /settings: an add form folded at the top, one
// collapsed row per goal, plain POST/303/GET, no fetch.
//
// Expired goals are lifted to the top rather than hidden. "It vanished from
// /today" reads as data loss; "到期了，续一期或归档" reads as a decision.

import type { Env, Goal, GoalTask, User } from '../types'
import { GOAL_EXTEND_DAYS } from '../types'
import {
  createGoal, createTask, deleteGoal, deleteTask, getGoal, listGoals, listTasks,
  moveGoal, setGoalArchived, shanghaiDate, updateGoal,
} from '../db'
import { DEFAULT_THEME, escapeHtml, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { icon } from './icons'
import { SCHEME_FIELD_CSS, SCHEME_FIELD_JS, schemeField } from './schemefield'
import { safeScheme } from '../scheme'
import { addDays, isExpired } from '../dates'
import { localeOf, translator, type Locale, type T } from '../i18n'

// --- route handler -----------------------------------------------------------

export async function handleGoals(request: Request, env: Env, user: User): Promise<Response> {
  // One translator per request, built here and handed to both halves — never
  // a module variable: a single isolate serves many requests at once.
  const loc = localeOf(request, user)
  const t = translator(loc)
  if (request.method === 'GET') return await render(env, user, {}, loc, t)
  if (request.method === 'POST') return await handlePost(request, env, user, loc, t)
  return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST' } })
}

interface Draft { title: string; cue: string; target: string; target_label: string; until: string }

const TITLE_MAX = 40
const CUE_MAX = 20
const LABEL_MAX = 12
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function field(form: FormData, key: string): string {
  const v = form.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

function intId(raw: string): number | null {
  return /^\d{1,12}$/.test(raw) ? Number(raw) : null
}

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** Returns the row to write, or a message for the reader, already translated. */
function validate(d: Draft, t: T): { title: string; cue: string; target: string; targetLabel: string; until: string | null } | string {
  if (d.title.length === 0) return t('目标名不能空着。')
  if (d.title.length > TITLE_MAX) return t('目标名太长了，{n} 个字以内。', { n: TITLE_MAX })
  if (d.cue.length > CUE_MAX) return t('触发时机太长了，{n} 个字以内。', { n: CUE_MAX })
  if (d.target_label.length > LABEL_MAX) return t('App 名太长了，{n} 个字以内。', { n: LABEL_MAX })
  if (d.target.length > 200) return t('跳转目标太长了。')
  if (d.target !== '' && safeScheme(d.target) === '') return t('跳转目标要长成 xxx:// 或 https:// 的样子，而且不能是脚本。')
  if (d.until !== '' && !validDate(d.until)) return t('日期要写成 2026-10-11 这样。')
  return { title: d.title, cue: d.cue, target: d.target, targetLabel: d.target_label, until: d.until === '' ? null : d.until }
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } })
}

async function handlePost(request: Request, env: Env, user: User, loc: Locale, t: T): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return await render(env, user, { error: t('表单没读出来，重试一次。'), status: 400 }, loc, t)
  }
  const op = field(form, 'op')
  const now = Date.now()
  const today = shanghaiDate(now)

  if (op === 'add' || op === 'save') {
    const draft: Draft = {
      title: field(form, 'title'), cue: field(form, 'cue'), target: field(form, 'target'),
      target_label: field(form, 'target_label'), until: field(form, 'until'),
    }
    const parsed = validate(draft, t)
    if (typeof parsed === 'string') {
      return await render(env, user, { error: parsed, draft, draftGoal: op === 'save' ? intId(field(form, 'goal')) : null, status: 400 }, loc, t)
    }
    if (op === 'add') {
      const id = await createGoal(env.DB, { userId: user.id, ...parsed, now })
      return seeOther(`/today/goals#goal-${id}`)
    }
    const id = intId(field(form, 'goal'))
    if (id === null) return await render(env, user, { error: t('目标编号不对。'), status: 400 }, loc, t)
    if (!(await updateGoal(env.DB, user.id, id, parsed))) return notFound()
    return seeOther(`/today/goals#goal-${id}`)
  }

  if (op === 'task_add') {
    const goalId = intId(field(form, 'goal'))
    const title = field(form, 'title')
    if (goalId === null) return await render(env, user, { error: t('目标编号不对。'), status: 400 }, loc, t)
    if (title.length === 0 || title.length > TITLE_MAX) {
      return await render(env, user, { error: t('子任务要有名字，{n} 个字以内。', { n: TITLE_MAX }), status: 400 }, loc, t)
    }
    const id = await createTask(env.DB, { userId: user.id, goalId, title, now })
    if (id === null) return notFound()
    return seeOther(`/today/goals#goal-${goalId}`)
  }

  if (op === 'task_delete') {
    const taskId = intId(field(form, 'task'))
    if (taskId === null) return await render(env, user, { error: t('子任务编号不对。'), status: 400 }, loc, t)
    const mine = (await listTasks(env.DB, user.id)).find((task: GoalTask) => task.id === taskId)
    if (!mine || !(await deleteTask(env.DB, user.id, taskId))) return notFound()
    return seeOther(`/today/goals#goal-${mine.goal_id}`)
  }

  const goalOps = new Set(['archive', 'restore', 'delete', 'up', 'down', 'extend'])
  if (!goalOps.has(op)) return await render(env, user, { error: t('不认识这个操作。'), status: 400 }, loc, t)
  const id = intId(field(form, 'goal'))
  if (id === null) return await render(env, user, { error: t('目标编号不对。'), status: 400 }, loc, t)
  const goal = await getGoal(env.DB, user.id, id)
  if (!goal) return notFound()

  switch (op) {
    case 'archive': await setGoalArchived(env.DB, user.id, id, now); break
    case 'restore': await setGoalArchived(env.DB, user.id, id, null); break
    case 'delete':
      // Two steps from the list on purpose: delete only exists in the archive fold.
      if (goal.archived_at === null) return await render(env, user, { error: t('先归档，再删除。'), status: 400 }, loc, t)
      await deleteGoal(env.DB, user.id, id)
      return seeOther('/today/goals')
    case 'up': await moveGoal(env.DB, user.id, id, 'up', today); break     // edge → false, still a redirect
    case 'down': await moveGoal(env.DB, user.id, id, 'down', today); break
    case 'extend':
      await updateGoal(env.DB, user.id, id, {
        title: goal.title, cue: goal.cue, target: goal.target, targetLabel: goal.target_label,
        until: addDays(today, GOAL_EXTEND_DAYS),
      })
      break
  }
  return seeOther(`/today/goals#goal-${id}`)
}

function notFound(): Response {
  return new Response('not found', { status: 404 })
}

// --- render ------------------------------------------------------------------

interface RenderOptions { error?: string; draft?: Draft; draftGoal?: number | null; status?: number }

async function render(env: Env, user: User, o: RenderOptions, loc: Locale, t: T): Promise<Response> {
  const today = shanghaiDate(Date.now())
  const goals = await listGoals(env.DB, user.id)
  const tasks = await listTasks(env.DB, user.id)
  const byGoal = new Map<number, GoalTask[]>()
  for (const t of tasks) {
    const arr = byGoal.get(t.goal_id) ?? []
    arr.push(t)
    byGoal.set(t.goal_id, arr)
  }
  const live = goals.filter((g) => g.archived_at === null && !isExpired(g, today))
  const expired = goals.filter((g) => g.archived_at === null && isExpired(g, today))
  const archived = goals.filter((g) => g.archived_at !== null)
  const addDraft = o.draft && (o.draftGoal === null || o.draftGoal === undefined) ? o.draft : undefined

  const body = `${consoleHeader(user, 'goals', t)}
<main>
  <h1>${t('目标')}</h1>
  <p class="lede">${t('未来一段时间最重要的几件事。排前面的三个会出现在<a href="/today">今日</a>。')}</p>
  ${o.error ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''}
  ${expired.length ? expiredBlock(expired, t) : ''}
  ${addBlock(t, addDraft)}
  ${live.length === 0 && expired.length === 0 ? `<p class="empty">${t('还没有目标。<br>用上面的 {plus} 加第一个。', { plus: icon('plus') })}</p>` : ''}
  ${live.map((g, i) => goalRow(g, byGoal.get(g.id) ?? [], { first: i === 0, last: i === live.length - 1, draft: o.draftGoal === g.id ? o.draft : undefined }, t)).join('\n')}
  ${archived.length ? archivedBlock(archived, t) : ''}
</main>`

  return page({
    title: t('目标 · 一息'),
    theme: DEFAULT_THEME,
    lang: loc,
    css: CONSOLE_CSS + SCHEME_FIELD_CSS + GOALS_CSS,
    body,
    script: SCHEME_FIELD_JS,
    status: o.status ?? 200,
  })
}

function expiredBlock(goals: Goal[], t: T): string {
  return goals.map((g) => `<form class="banner expired" method="post" action="/today/goals">
    <input type="hidden" name="goal" value="${g.id}">
    <span>${t('<b>{title}</b> 到期了（{until}）。', { title: escapeHtml(g.title), until: escapeHtml(g.until ?? '') })}</span>
    <span class="acts">
      <button class="linky" type="submit" name="op" value="extend">${t('续四周')}</button>
      <button class="linky" type="submit" name="op" value="archive">${t('归档')}</button>
    </span>
  </form>`).join('\n')
}

function addBlock(t: T, d?: Draft): string {
  return `<details class="add"${d ? ' open' : ''}>
  <summary class="addbtn">${icon('plus', { cls: 'ic lg' })}<span>${t('加一个目标')}</span></summary>
  <form class="card addform" method="post" action="/today/goals" data-ns="NEW">
  ${goalFields(d ?? { title: '', cue: '', target: '', target_label: '', until: '' }, 'NEW', t)}
  <div class="actions"><button class="primary" type="submit" name="op" value="add">${t('添加')}</button></div>
  </form>
</details>`
}

function goalFields(d: Draft, ns: string, t: T): string {
  const id = (n: string): string => `f-${ns}-${n}`
  return `<div class="field">
    <label for="${id('title')}">${t('目标 · 一句话')}</label>
    <input id="${id('title')}" type="text" name="title" value="${escapeHtml(d.title)}" placeholder="${t('健身')}" required maxlength="${TITLE_MAX}">
  </div>
  <div class="field">
    <label for="${id('cue')}">${t('什么时候做 · 可不填')}</label>
    <input id="${id('cue')}" type="text" name="cue" value="${escapeHtml(d.cue)}" placeholder="${t('早饭后')}" maxlength="${CUE_MAX}">
  </div>
  ${schemeField({
    name: 'target', value: d.target, ns, required: false, labelFor: 'target_label',
    label: t('去做时跳去哪 · 可不填'),
    placeholder: t('bilibili:// 或 https://…'),
    hint: t('填<b>具体那一节课、那一本书</b>的链接，比填 App 首页少走两步。自定义 scheme 填完点<b>试跳</b>，App 真打开了才算数；https 链接不用试。'),
  })}
  <div class="row">
    <div class="field">
      <label for="${id('target_label')}">${t('按钮上叫它什么')}</label>
      <input id="${id('target_label')}" type="text" name="target_label" value="${escapeHtml(d.target_label)}" placeholder="${t('B 站')}" maxlength="${LABEL_MAX}">
    </div>
    <div class="field">
      <label for="${id('until')}">${t('做到哪天 · 可不填')}</label>
      <input id="${id('until')}" type="date" name="until" value="${escapeHtml(d.until)}" class="num">
    </div>
  </div>`
}

function goalRow(g: Goal, tasks: GoalTask[], o: { first: boolean; last: boolean; draft?: Draft }, t: T): string {
  const d: Draft = o.draft ?? { title: g.title, cue: g.cue, target: g.target, target_label: g.target_label, until: g.until ?? '' }
  const undone = tasks.filter((t) => t.done_at === null)
  const ns = `g${g.id}`
  return `<details class="app" id="goal-${g.id}"${o.draft ? ' open' : ''}>
  <summary>
    <span class="sname">${escapeHtml(g.title)}</span>
    ${g.target_label ? `<span class="skey">${escapeHtml(g.target_label)}</span>` : ''}
    <span class="mini">${g.until ? `<span class="num">${escapeHtml(g.until)}</span>` : t('长期')}${tasks.length ? ` · ${undone.length}/${tasks.length}` : ''}</span>
    ${icon('chev', { cls: 'ic chev' })}
  </summary>
  <form class="card" method="post" action="/today/goals" data-ns="${ns}">
    <input type="hidden" name="goal" value="${g.id}">
    ${goalFields(d, ns, t)}
    <div class="actions">
      <button class="primary" type="submit" name="op" value="save">${t('保存')}</button>
      <button class="linky" type="submit" name="op" value="up" formnovalidate${o.first ? ' disabled' : ''}>${t('上移')}</button>
      <button class="linky" type="submit" name="op" value="down" formnovalidate${o.last ? ' disabled' : ''}>${t('下移')}</button>
      <button class="linky" type="submit" name="op" value="archive" formnovalidate>${t('归档')}</button>
    </div>
  </form>
  <div class="card tasks">
    <h2>${t('子任务 · 一次性的待办')}</h2>
    ${tasks.length === 0 ? `<p class="note flat">${t('还没有。')}</p>` : `<ul class="tl">${tasks.map((task) => `<li class="${task.done_at === null ? '' : 'done'}">
      <span>${escapeHtml(task.title)}</span>
      <form method="post" action="/today/goals"><input type="hidden" name="task" value="${task.id}"><button class="linky" type="submit" name="op" value="task_delete">${t('删')}</button></form>
    </li>`).join('')}</ul>`}
    <form method="post" action="/today/goals" class="taskadd">
      <input type="hidden" name="goal" value="${g.id}">
      <input type="text" name="title" placeholder="${t('加一条子任务')}" maxlength="${TITLE_MAX}" required aria-label="${t('子任务')}">
      <button class="linky" type="submit" name="op" value="task_add">${t('加')}</button>
    </form>
  </div>
</details>`
}

function archivedBlock(goals: Goal[], t: T): string {
  return `<details class="archived">
  <summary>${icon('chev', { cls: 'chev' })}${t('已归档 · {n}', { n: goals.length })}</summary>
  ${goals.map((g) => `<form class="arow" method="post" action="/today/goals" id="goal-${g.id}">
    <input type="hidden" name="goal" value="${g.id}">
    <span class="sname">${escapeHtml(g.title)}</span>
    <button class="linky" type="submit" name="op" value="restore">${t('恢复')}</button>
    <button class="linky danger" type="submit" name="op" value="delete" onclick="return confirm('${t('删掉这个目标？子任务会一起删，打卡记录保留。')}')">${t('删除')}</button>
  </form>`).join('\n')}
</details>`
}

const GOALS_CSS = `
.banner.expired{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.banner.expired .acts{margin-left:auto;display:flex;gap:12px}
details.app > .card.tasks{border:0;border-top:1px solid var(--rule);border-radius:0;margin:0}
.tl{list-style:none;margin:0 0 10px;padding:0}
.tl li{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--rule)}
.tl li span{flex:1;min-width:0}
.tl li.done span{color:var(--faint);text-decoration:line-through}
.tl li form{margin:0}
.taskadd{display:flex;gap:8px;align-items:center}
.taskadd input{flex:1;min-width:0}
details.archived{margin:24px 0 0}
.arow{display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--rule)}
.arow .sname{flex:1;color:var(--dim)}
button.linky[disabled]{opacity:.35}
input[type=date]{display:block;width:100%;font:inherit;font-size:16px;line-height:1.4;padding:10px 12px;
  color:var(--fg);background:transparent;border:1px solid var(--rule);border-radius:10px}
`
