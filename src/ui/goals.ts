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
import { GOAL_EXTEND_DAYS, TODAY_GOALS_MAX, TODAY_GOALS_MIN, todayGoalLimit } from '../types'
import {
  createGoal, createTask, deleteGoal, deleteTask, getGoal, getTask, listGoals, listTaskCheckins, listTasks,
  moveGoal, setGoalArchived, setUserTodayGoals, shanghaiDate, syncGoalCheckin, updateGoal, updateTaskTarget,
} from '../db'
import { DEFAULT_THEME, escapeHtml, jsSingleQuotedBody, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { icon } from './icons'
import { SCHEME_FIELD_CSS, fieldId, schemeFieldJs, schemeField } from './schemefield'
import { safeScheme } from '../scheme'
import { addDays, isExpired } from '../dates'
import { localeOf, translator, type Locale, type T } from '../i18n'

// --- route handler -----------------------------------------------------------

export async function handleGoals(request: Request, env: Env, user: User): Promise<Response> {
  // One translator per request, built here and handed to both halves — never
  // a module variable: a single isolate serves many requests at once.
  const loc = localeOf(request, user)
  const t = translator(loc)
  if (request.method === 'GET') {
    const url = new URL(request.url)
    return await render(env, user, { openGoal: queryId(url, 'goal'), openTask: queryId(url, 'task') }, loc, t)
  }
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

/**
 * `?goal=` / `?task=` on the GET — reader-supplied, so the same "digits-only
 * or ignore it" rule as `intId` applies: never a 400, never an error page.
 * Whether the id is actually this user's own is decided later, the same way
 * a stale `#goal-<id>` fragment already was — by simply matching nothing.
 */
function queryId(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key)
  return raw === null ? undefined : (intId(raw) ?? undefined)
}

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** 跳转目标的三条规则，目标和子任务共用。通过返回 null，否则返回给读者看的句子。 */
function validateTarget(target: string, label: string, t: T): string | null {
  if (label.length > LABEL_MAX) return t('App 名太长了，{n} 个字以内。', { n: LABEL_MAX })
  if (target.length > 200) return t('跳转目标太长了。')
  if (target !== '' && safeScheme(target) === '') return t('跳转目标要长成 xxx:// 或 https:// 的样子，而且不能是脚本。')
  return null
}

/** Returns the row to write, or a message for the reader, already translated. */
function validate(d: Draft, t: T): { title: string; cue: string; target: string; targetLabel: string; until: string | null } | string {
  if (d.title.length === 0) return t('目标名不能空着。')
  if (d.title.length > TITLE_MAX) return t('目标名太长了，{n} 个字以内。', { n: TITLE_MAX })
  if (d.cue.length > CUE_MAX) return t('触发时机太长了，{n} 个字以内。', { n: CUE_MAX })
  const badTarget = validateTarget(d.target, d.target_label, t)
  if (badTarget !== null) return badTarget
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
      return seeOther(`/today/goals?goal=${id}#goal-${id}`)
    }
    const id = intId(field(form, 'goal'))
    if (id === null) return await render(env, user, { error: t('目标编号不对。'), status: 400 }, loc, t)
    if (!(await updateGoal(env.DB, user.id, id, parsed))) return notFound()
    return seeOther(`/today/goals?goal=${id}#goal-${id}`)
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
    // A goal that was complete for today has just grown an unchecked row, so
    // today's derived check-in has to come back off.
    await syncGoalCheckin(env.DB, user.id, goalId, today, now)
    // 目标和这条新子任务的折叠都张开，输入框还带 autofocus——加完接着填，不用
    // 自己再把行和折叠一层层打开一遍。
    return seeOther(`/today/goals?goal=${goalId}&task=${id}#task-${id}`)
  }

  if (op === 'task_save') {
    const taskId = intId(field(form, 'task'))
    if (taskId === null) return await render(env, user, { error: t('子任务编号不对。'), status: 400 }, loc, t)
    const target = field(form, 'target')
    const targetLabel = field(form, 'target_label')
    const badTarget = validateTarget(target, targetLabel, t)
    if (badTarget !== null) {
      const taskDraft = { task: taskId, target, target_label: targetLabel }
      return await render(env, user, { error: badTarget, taskDraft, status: 400 }, loc, t)
    }
    const mine = await getTask(env.DB, user.id, taskId)
    if (!mine || !(await updateTaskTarget(env.DB, user.id, taskId, target, targetLabel))) return notFound()
    return seeOther(`/today/goals?goal=${mine.goal_id}#goal-${mine.goal_id}`)
  }

  if (op === 'task_delete') {
    const taskId = intId(field(form, 'task'))
    if (taskId === null) return await render(env, user, { error: t('子任务编号不对。'), status: 400 }, loc, t)
    const mine = await getTask(env.DB, user.id, taskId)
    if (!mine || !(await deleteTask(env.DB, user.id, taskId))) return notFound()
    // Deleting the last unchecked row completes today's set, so the derived
    // check-in has to appear.
    await syncGoalCheckin(env.DB, user.id, mine.goal_id, today, now)
    return seeOther(`/today/goals?goal=${mine.goal_id}#goal-${mine.goal_id}`)
  }

  if (op === 'limit') {
    // 和这一页的编号一样只认纯数字：一个 <select> 只会送回 1…9，所以到这里的
    // 别的东西都是手捏的请求，回它一句人话而不是一个 500。
    const n = intId(field(form, 'n'))
    if (n === null || n < TODAY_GOALS_MIN || n > TODAY_GOALS_MAX) {
      return await render(env, user, {
        error: t('只能是 {min} 到 {max} 之间的一个数。', { min: TODAY_GOALS_MIN, max: TODAY_GOALS_MAX }),
        status: 400,
      }, loc, t)
    }
    await setUserTodayGoals(env.DB, user.id, n)
    return seeOther('/today/goals')
  }

  const goalOps = new Set(['archive', 'restore', 'delete', 'up', 'down', 'extend'])
  if (!goalOps.has(op)) return await render(env, user, { error: t('不认识这个操作。'), status: 400 }, loc, t)
  const id = intId(field(form, 'goal'))
  if (id === null) return await render(env, user, { error: t('目标编号不对。'), status: 400 }, loc, t)
  const goal = await getGoal(env.DB, user.id, id)
  if (!goal) return notFound()

  switch (op) {
    // archive/restore move the row out of (or into) the live list this same
    // response renders, so there is no live goalRow left for `?goal=` to open
    // — same as before this change, target left alone on purpose.
    case 'archive':
      await setGoalArchived(env.DB, user.id, id, now)
      return seeOther(`/today/goals#goal-${id}`)
    case 'restore':
      await setGoalArchived(env.DB, user.id, id, null)
      return seeOther(`/today/goals#goal-${id}`)
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
  // up/down/extend all fall through here: the goal the reader acted on stays
  // open, same reasoning as save above.
  return seeOther(`/today/goals?goal=${id}#goal-${id}`)
}

function notFound(): Response {
  return new Response('not found', { status: 404 })
}

// --- render ------------------------------------------------------------------

/** 一条子任务被退回来时，用户刚敲的那两格——和 Draft 之于目标是一回事。 */
interface TaskDraft { task: number; target: string; target_label: string }

interface RenderOptions {
  error?: string; draft?: Draft; draftGoal?: number | null; taskDraft?: TaskDraft; status?: number
  /** `?goal=`／`?task=` off the GET — see `queryId`. Additive to the existing draft-driven opening below. */
  openGoal?: number
  openTask?: number
}

async function render(env: Env, user: User, o: RenderOptions, loc: Locale, t: T): Promise<Response> {
  const today = shanghaiDate(Date.now())
  const goals = await listGoals(env.DB, user.id)
  const tasks = await listTasks(env.DB, user.id)
  const doneToday = new Set((await listTaskCheckins(env.DB, user.id, today, today)).map((c) => c.task_id))
  const byGoal = new Map<number, GoalTask[]>()
  for (const task of tasks) {
    const arr = byGoal.get(task.goal_id) ?? []
    arr.push(task)
    byGoal.set(task.goal_id, arr)
  }
  // 退回来的子任务草稿要送回它自己那一行：先按 user 圈定的 tasks 找出它属于哪个
  // 目标，找不到（不是他的、或已经不在了）就当没这回事，只留顶上的横幅。
  const td = o.taskDraft
  const tdGoal = td ? tasks.find((tk) => tk.id === td.task)?.goal_id ?? null : null
  const live = goals.filter((g) => g.archived_at === null && !isExpired(g, today))
  const expired = goals.filter((g) => g.archived_at === null && isExpired(g, today))
  const archived = goals.filter((g) => g.archived_at !== null)
  const addDraft = o.draft && (o.draftGoal === null || o.draftGoal === undefined) ? o.draft : undefined
  // tdGoal 非空说明这条错误已经摆在对应子任务的折叠里了，顶上不用再重复一遍。
  const topBanner = o.error && tdGoal === null ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''

  const body = `${consoleHeader(user, 'goals', t)}
<main>
  <h1>${t('目标')}</h1>
  <p class="lede">${t('未来一段时间最重要的几件事。排前面的 {n} 个会出现在<a href="/today">今日</a>。', { n: todayGoalLimit(user) })}</p>
  ${topBanner}
  ${expired.length ? expiredBlock(expired, t) : ''}
  ${addBlock(t, addDraft)}
  ${live.length === 0 && expired.length === 0 ? `<p class="empty">${t('还没有目标。<br>用上面的 {plus} 加第一个。', { plus: icon('plus') })}</p>` : ''}
  ${live.map((g, i) => goalRow(g, byGoal.get(g.id) ?? [], doneToday, {
    first: i === 0,
    last: i === live.length - 1,
    draft: o.draftGoal === g.id ? o.draft : undefined,
    taskDraft: tdGoal === g.id ? td : undefined,
    taskError: tdGoal === g.id ? o.error : undefined,
    openGoal: o.openGoal === g.id,
    openTask: o.openTask,
  }, t)).join('\n')}
  ${limitBlock(todayGoalLimit(user), t)}
  ${archived.length ? archivedBlock(archived, t) : ''}
</main>`

  return page({
    title: t('目标 · 一息'),
    theme: DEFAULT_THEME,
    lang: loc,
    css: CONSOLE_CSS + SCHEME_FIELD_CSS + GOALS_CSS,
    body,
    script: schemeFieldJs(t) + LIMIT_JS,
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

/**
 * `data-ns` is the localStorage key a 试跳 draft is parked under, and it is
 * global to the origin — `'yixi.draft.' + ns` in schemefield.ts. /settings'
 * add-App form calls itself `NEW` too, so both pages used to write the same
 * key: probe a scheme there, come here inside the 30-minute TTL, and this
 * form would spring open holding another page's half-filled row. Named per
 * page, the two drafts stop colliding.
 */
const ADD_NS = 'NEW_GOAL'

function addBlock(t: T, d?: Draft): string {
  return `<details class="add"${d ? ' open' : ''}>
  <summary class="addbtn">${icon('plus', { cls: 'ic lg' })}<span>${t('加一个目标')}</span></summary>
  <form class="card addform" method="post" action="/today/goals" data-ns="${ADD_NS}">
  ${goalFields(d ?? { title: '', cue: '', target: '', target_label: '', until: '' }, ADD_NS, t, d !== undefined)}
  <div class="actions"><button class="primary" type="submit" name="op" value="add">${t('添加')}</button></div>
  </form>
</details>`
}

/**
 * 一个目标的四格。跳转那两格（跳去哪、按钮上叫它什么）折起来，和子任务的
 * 「跳去哪」用同一个 details.tapp，看起来是同一件事——因为它就是同一件事。
 *
 * 折叠默认收着，即使已经绑了 App：目标行自己的摘要上已经挂着那枚 App 名
 * （.skey），不必把整段跳转设置摊开来再说一遍。只有这张表单是被退回来的
 * （`open`，即手上有 draft）才张开，否则用户刚敲的字藏在折叠里，等于没退回。
 *
 * 「做到哪天」不属于跳转，留在折叠外面，单独一格——原先它和「按钮上叫它什么」
 * 并排成一行，现在那一半进了折叠，两栏的 .row 也就没有了。
 */
function goalFields(d: Draft, ns: string, t: T, open: boolean): string {
  const id = (n: string): string => `f-${ns}-${n}`
  return `<div class="field">
    <label for="${id('title')}">${t('目标 · 一句话')}</label>
    <input id="${id('title')}" type="text" name="title" value="${escapeHtml(d.title)}" required maxlength="${TITLE_MAX}">
  </div>
  <div class="field">
    <label for="${id('cue')}">${t('什么时候做 · 可不填')}</label>
    <input id="${id('cue')}" type="text" name="cue" value="${escapeHtml(d.cue)}" maxlength="${CUE_MAX}">
  </div>
  <details class="tapp"${open ? ' open' : ''}>
    <summary>${icon('chev', { cls: 'ic chev' })}${t('跳去哪')}</summary>
    ${schemeField({
      name: 'target', value: d.target, ns, required: false, labelFor: 'target_label', t,
      label: t('去做时跳去哪 · 可不填'),
      placeholder: t('bilibili:// 或 https://…'),
      hint: t('填<b>具体那一节课、那一本书</b>的链接，比填 App 首页少走两步。自定义 scheme 填完点<b>试跳</b>，App 真打开了才算数；https 链接不用试。'),
    })}
    <div class="field">
      <label for="${id('target_label')}">${t('按钮上叫它什么')}</label>
      <input id="${id('target_label')}" type="text" name="target_label" value="${escapeHtml(d.target_label)}" maxlength="${LABEL_MAX}">
    </div>
  </details>
  <div class="field">
    <label for="${id('until')}">${t('做到哪天 · 可不填')}</label>
    <input id="${id('until')}" type="date" name="until" value="${escapeHtml(d.until)}" class="num">
  </div>`
}

function goalRow(
  g: Goal,
  tasks: GoalTask[],
  doneToday: Set<number>,
  o: { first: boolean; last: boolean; draft?: Draft; taskDraft?: TaskDraft; taskError?: string; openGoal?: boolean; openTask?: number },
  t: T,
): string {
  const d: Draft = o.draft ?? { title: g.title, cue: g.cue, target: g.target, target_label: g.target_label, until: g.until ?? '' }
  const ns = `g${g.id}`
  const done = tasks.filter((task) => doneToday.has(task.id)).length
  // 子任务被退回来时这一行也得张开：那条报错在折叠里，行收着就等于没说。
  // `?goal=<id>` 说的是同一件事——读者刚在这一行里做完一件事，回来时它不该收着。
  return `<details class="app" id="goal-${g.id}"${o.draft || o.taskDraft || o.openGoal ? ' open' : ''}>
  <summary>
    <span class="sname">${escapeHtml(g.title)}</span>
    ${g.target_label ? `<span class="skey">${escapeHtml(g.target_label)}</span>` : ''}
    <span class="mini">${g.until ? `<span class="num">${escapeHtml(g.until)}</span>` : t('长期')}${tasks.length ? ` · ${t('今天 {x}/{n}', { x: done, n: tasks.length })}` : ''}</span>
    ${icon('chev', { cls: 'ic chev' })}
  </summary>
  <form class="card" method="post" action="/today/goals" data-ns="${ns}">
    <input type="hidden" name="goal" value="${g.id}">
    ${goalFields(d, ns, t, o.draft !== undefined)}
    <div class="actions">
      <button class="primary" type="submit" name="op" value="save">${t('保存')}</button>
      <button class="linky" type="submit" name="op" value="up" formnovalidate${o.first ? ' disabled' : ''}>${t('上移')}</button>
      <button class="linky" type="submit" name="op" value="down" formnovalidate${o.last ? ' disabled' : ''}>${t('下移')}</button>
      <button class="linky" type="submit" name="op" value="archive" formnovalidate>${t('归档')}</button>
    </div>
  </form>
  <div class="card tasks">
    <h2>${t('子任务 · 每天都做')}${tasks.length ? `<span class="n num">${t('今天 {x}/{n}', { x: done, n: tasks.length })}</span>` : ''}</h2>
    ${tasks.length === 0 ? `<p class="note flat">${t('还没有。')}</p>` : `<ul class="tl">${tasks.map((task) => taskRow(task, { draft: o.taskDraft, error: o.taskError, openTask: o.openTask }, t)).join('')}</ul>`}
    <form method="post" action="/today/goals" class="taskadd">
      <input type="hidden" name="goal" value="${g.id}">
      <input type="text" name="title" placeholder="${t('加一条子任务')}" maxlength="${TITLE_MAX}" required aria-label="${t('子任务')}">
      <button class="linky" type="submit" name="op" value="task_add">${t('加')}</button>
    </form>
  </div>
</details>`
}

/**
 * 一条子任务：标题、已绑的 App 名、删，外加一个折起来的跳转设置表单。
 *
 * 表单是同级而不是嵌套——HTML 里 form 不能套 form，而目标本身那张表单就在上面
 * 几行。schemefield 的脚本按 `.field.scheme` 和 `form[data-ns]` 找东西，所以这里
 * 只要给每条子任务一个自己的 ns，试跳、候选和草稿恢复全都照常工作。
 *
 * 被退回来的那一条（`o.draft` 指着它）张着、填着用户刚敲的字、报错就摆在字上面；
 * 其余各条照常用库里的值。折叠上的那句话两种状态一模一样：绑没绑得看标题旁那枚
 * App 名（.skey），摘要只负责说清这里面装的是什么。
 *
 * `o.openTask` 是 `?task=<id>` 直接点名的那一条——多半是刚 task_add 完的新行，
 * 折叠张开还不够，输入框得带 autofocus，读者不用自己再点一下。一份文档里只有
 * 一条任务的 id 能等于它，所以这条 autofocus 全文只会出现这一处。
 */
function taskRow(task: GoalTask, o: { draft?: TaskDraft; error?: string; openTask?: number }, t: T): string {
  const ns = `t${task.id}`
  const d = o.draft && o.draft.task === task.id ? o.draft : undefined
  const focus = task.id === o.openTask
  return `<li id="task-${task.id}">
    <div class="trow">
      <span class="tname">${escapeHtml(task.title)}</span>
      ${task.target_label ? `<span class="skey">${escapeHtml(task.target_label)}</span>` : ''}
      <form method="post" action="/today/goals"><input type="hidden" name="task" value="${task.id}"><button class="linky" type="submit" name="op" value="task_delete">${t('删')}</button></form>
    </div>
    <details class="tapp"${d || focus ? ' open' : ''}>
      <summary>${icon('chev', { cls: 'ic chev' })}${t('跳去哪')}</summary>
      <form method="post" action="/today/goals" data-ns="${ns}">
        <input type="hidden" name="task" value="${task.id}">
        ${d && o.error ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''}
        ${schemeField({
          name: 'target', value: d ? d.target : task.target, ns, required: false, labelFor: 'target_label', t,
          label: t('这条子任务跳去哪 · 可不填'),
          placeholder: t('bilibili:// 或 https://…'),
          hint: t('不填就跟着目标走。自定义 scheme 填完点<b>试跳</b>，App 真打开了才算数；https 链接不用试。'),
          autofocus: focus,
        })}
        <div class="field">
          <label for="${fieldId(ns, 'target_label')}">${t('按钮上叫它什么')}</label>
          <input id="${fieldId(ns, 'target_label')}" type="text" name="target_label" value="${escapeHtml(d ? d.target_label : task.target_label)}" maxlength="${LABEL_MAX}">
        </div>
        <div class="actions"><button class="primary" type="submit" name="op" value="task_save">${t('存')}</button></div>
      </form>
    </details>
  </li>`
}

/**
 * 「今日页放几个目标」——这一页上唯一一件不属于任何一个目标的事，所以它排在
 * 目标列表之后、归档之前：先看完手上的几件事，再决定今日页放得下几件。
 *
 * <select> 而不是 type=number：iPhone 上前者是一个滚轮，一下选完；后者是一个
 * 数字键盘加一对小箭头，为了在 1 到 9 之间挑一个数实在太吵。
 *
 * 「存」这个按钮在标记里是常驻的，不是可有可无的备份：有 JS 时 LIMIT_JS 让选完
 * 就存（和同页的上移／归档一样，点了就算数），没 JS 时它就是唯一的出口。两条路
 * 发的是同一个 POST。
 */
function limitBlock(current: number, t: T): string {
  const options = []
  for (let n = TODAY_GOALS_MIN; n <= TODAY_GOALS_MAX; n++) {
    options.push(`<option value="${n}"${n === current ? ' selected' : ''}>${n}</option>`)
  }
  return `<form class="card limit" method="post" action="/today/goals">
  <label for="f-limit-n">${t('今日页放几个目标')}</label>
  <div class="limitrow">
    <select id="f-limit-n" name="n" class="num">${options.join('')}</select>
    <button class="linky" type="submit" name="op" value="limit">${t('存')}</button>
  </div>
</form>`
}

/**
 * Spin the wheel, and it is saved — no second tap on 「存」.
 *
 * Everything else on this page acts on tap (上移, 归档, 删), so a picker that
 * remembered nothing until you found a second button was the odd one out: spin
 * it, walk away, and the change was gone with no signal that it had not stuck.
 *
 * `requestSubmit` is given the 「存」 button as its submitter on purpose. A bare
 * `requestSubmit()` submits no button, so `op=limit` — which lives on that
 * button's name/value — would never reach the server and the write would come
 * back 400. `click()` is the fallback for an engine without `requestSubmit`; it
 * submits with the same button as submitter, so the body is identical either
 * way. Nothing here removes or hides the button: without JS it is still the
 * only way to save, and this listener is the only thing that changes.
 *
 * Carries no copy, so it needs no translator — same rule as TODAY_JS.
 */
const LIMIT_JS = `
(function () {
  var sel = document.getElementById('f-limit-n');
  if (!sel) return;
  var form = sel.form;
  var save = form ? form.querySelector('button[type="submit"]') : null;
  if (!form || !save) return;
  sel.addEventListener('change', function () {
    if (form.requestSubmit) form.requestSubmit(save);
    else save.click();
  });
})();
`

function archivedBlock(goals: Goal[], t: T): string {
  return `<details class="archived">
  <summary>${icon('chev', { cls: 'chev' })}${t('已归档 · {n}', { n: goals.length })}</summary>
  ${goals.map((g) => `<form class="arow" method="post" action="/today/goals" id="goal-${g.id}">
    <input type="hidden" name="goal" value="${g.id}">
    <span class="sname">${escapeHtml(g.title)}</span>
    <button class="linky" type="submit" name="op" value="restore">${t('恢复')}</button>
    <button class="linky danger" type="submit" name="op" value="delete" onclick="return confirm('${escapeHtml(jsSingleQuotedBody(t('删掉这个目标？子任务会一起删，打卡记录保留。')))}')">${t('删除')}</button>
  </form>`).join('\n')}
</details>`
}

const GOALS_CSS = `
.banner.expired{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.banner.expired .acts{margin-left:auto;display:flex;gap:12px}
/* 赭石 · 子任务。整块铺一层淡底，边框就该退场——填色和边框说的是同一句话，
   两个一起上就是把一句话说两遍，所以原来那条 border-top 去掉了。标题染赭石，
   行与行之间的细线也跟着赭石，一眼看得出这几行是同一段里的东西。 */
details.app > .card.tasks{border:0;border-radius:0;margin:0;background:var(--zhe-wash)}
.card.tasks h2{display:flex;align-items:baseline;color:var(--zhe)}
/* 「今天 1/2」搬进标题右端。目标行摘要上那一份留着——行收起来时这个标题不在
   眼前，两处各答各的问题。标记上挂的 .num 是为了数字不随宽窄跳动。 */
.card.tasks h2 .n{margin-left:auto;letter-spacing:0;color:var(--faint)}
.tl{list-style:none;margin:0 0 10px;padding:0}
.tl li{padding:6px 0;border-bottom:1px solid var(--zhe-rule)}
.tl .trow{display:flex;align-items:center;gap:10px}
.tl .tname{flex:1;min-width:0}
.tl .trow form{margin:0}
/* 花青 · 跳转。目标的那一份和每条子任务的那一份是同一个 details.tapp，所以
   底色、圆角、摘要的颜色只写一遍——它们本来就是同一件事。填色代替边框，段上
   不再叠线。收着的时候摘要用负外边距把自己撑到底色的两边，那 44px 的一行整条
   都可按；张开时下边距换成正的 8px，给里面的表单让出一口气。 */
details.tapp{background:var(--qing-wash);border-radius:12px;padding:12px 12px 4px}
/* 目标那一份夹在两格中间，底下得自己带 14px，和 .field 的节奏对齐；子任务那
   一份是 li 的第二行，留着 icons.ts 给 details 的 7px 就够。 */
form > details.tapp{margin:0 0 14px}
/* 尺寸、旋转和去掉系统三角都由 icons.ts 的通用 summary 规则管，这里只管排布。
   details.app 那一段之所以还自带一份，是因为它把 .chev 覆写成了 14px。 */
details.tapp > summary{display:flex;align-items:center;gap:6px;min-height:44px;font-size:14px;
  color:var(--qing);margin:-12px -12px -4px;padding:0 12px}
/* icons.ts 的通用规则会把张开的 summary 拽回 --fg，details.app 也有自己的一份；
   跳转这一段两种状态都是花青，收着和张开说的是同一件事。 */
details.tapp[open] > summary{color:var(--qing);margin-bottom:8px}
/* 输入框浮在底色上——透明的框会把那层淡底吃进去，看着像被按暗了一块。 */
details.tapp input[type=text],.card.tasks .taskadd input{background:var(--bg)}
/* 「按 App 名字找」那一格是这段里唯一还需要一条边的东西，边也换成花青。 */
details.tapp details.pickwrap > summary{border-color:var(--qing-rule)}
details.tapp > form{margin:0 0 10px}
/* 目标那一份是 form > details（HTML 里 form 不能套 form，子任务只好反过来），
   所以折叠里直接躺着几个 .field，最后一格的下边距由它自己带。 */
details.tapp > .field:last-child{margin-bottom:10px}
details.tapp > form > .banner{margin:10px 0 14px}
.taskadd{display:flex;gap:8px;align-items:center}
.taskadd input{flex:1;min-width:0}
.card.limit label{margin:0 0 8px}
/* 那枚箭头是自己画的，挂在这一行上：替换元素没有 ::after，画不进 select 里去。
   定位靠 --sel-w——select 的宽度写死一次，箭头按同一个数往回退，两个数不会各自漂。
   pointer-events:none 让点在箭头上的那一下照样落进 select。 */
.limitrow{--sel-w:72px;position:relative;display:flex;gap:14px;align-items:center}
.limitrow select{width:var(--sel-w);flex:none}
.limitrow::after{content:"";position:absolute;left:calc(var(--sel-w) - 22px);top:50%;margin-top:-2px;
  width:7px;height:7px;border-right:1.4px solid var(--dim);border-bottom:1.4px solid var(--dim);
  transform:translateY(-50%) rotate(45deg);pointer-events:none}
/* 页面作用域的裸 select，和下面那条 input[type=date] 一个道理：console.ts 的通用
   输入框规则按类型列举，这两种它都没列到。min-height 跟着 44px 的触达底线。
   appearance:none 不是为了好看：WebKit 对一个默认外观的 select 压根不认作者写的
   padding 和 min-height（iPhone 14 实测，计算值是 padding 0px、min-height 18px，
   盒子 23px 高，写 !important 也压不动），关掉原生外观才回到 44px。代价是原生那
   枚小箭头跟着没了，所以上面那条自己画一个。 */
select{font:inherit;font-size:16px;line-height:1.4;padding:10px 12px;color:var(--fg);
  background:transparent;border:1px solid var(--rule);border-radius:10px;min-height:44px;
  -webkit-appearance:none;appearance:none}
details.archived{margin:24px 0 0}
.arow{display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--rule)}
.arow .sname{flex:1;color:var(--dim)}
button.linky[disabled]{opacity:.35}
input[type=date]{display:block;width:100%;font:inherit;font-size:16px;line-height:1.4;padding:10px 12px;
  color:var(--fg);background:transparent;border:1px solid var(--rule);border-radius:10px}
`
