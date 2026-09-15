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
    // A goal that was complete for today has just grown an unchecked row, so
    // today's derived check-in has to come back off.
    await syncGoalCheckin(env.DB, user.id, goalId, today, now)
    return seeOther(`/today/goals#goal-${goalId}`)
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
    return seeOther(`/today/goals#goal-${mine.goal_id}`)
  }

  if (op === 'task_delete') {
    const taskId = intId(field(form, 'task'))
    if (taskId === null) return await render(env, user, { error: t('子任务编号不对。'), status: 400 }, loc, t)
    const mine = await getTask(env.DB, user.id, taskId)
    if (!mine || !(await deleteTask(env.DB, user.id, taskId))) return notFound()
    // Deleting the last unchecked row completes today's set, so the derived
    // check-in has to appear.
    await syncGoalCheckin(env.DB, user.id, mine.goal_id, today, now)
    return seeOther(`/today/goals#goal-${mine.goal_id}`)
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

/** 一条子任务被退回来时，用户刚敲的那两格——和 Draft 之于目标是一回事。 */
interface TaskDraft { task: number; target: string; target_label: string }

interface RenderOptions { error?: string; draft?: Draft; draftGoal?: number | null; taskDraft?: TaskDraft; status?: number }

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
    script: schemeFieldJs(t),
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
  ${goalFields(d ?? { title: '', cue: '', target: '', target_label: '', until: '' }, 'NEW', t, d !== undefined)}
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
  o: { first: boolean; last: boolean; draft?: Draft; taskDraft?: TaskDraft; taskError?: string },
  t: T,
): string {
  const d: Draft = o.draft ?? { title: g.title, cue: g.cue, target: g.target, target_label: g.target_label, until: g.until ?? '' }
  const ns = `g${g.id}`
  const done = tasks.filter((task) => doneToday.has(task.id)).length
  // 子任务被退回来时这一行也得张开：那条报错在折叠里，行收着就等于没说。
  return `<details class="app" id="goal-${g.id}"${o.draft || o.taskDraft ? ' open' : ''}>
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
    <h2>${t('子任务 · 每天都做')}</h2>
    ${tasks.length === 0 ? `<p class="note flat">${t('还没有。')}</p>` : `<ul class="tl">${tasks.map((task) => taskRow(task, { draft: o.taskDraft, error: o.taskError }, t)).join('')}</ul>`}
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
 */
function taskRow(task: GoalTask, o: { draft?: TaskDraft; error?: string }, t: T): string {
  const ns = `t${task.id}`
  const d = o.draft && o.draft.task === task.id ? o.draft : undefined
  return `<li>
    <div class="trow">
      <span class="tname">${escapeHtml(task.title)}</span>
      ${task.target_label ? `<span class="skey">${escapeHtml(task.target_label)}</span>` : ''}
      <form method="post" action="/today/goals"><input type="hidden" name="task" value="${task.id}"><button class="linky" type="submit" name="op" value="task_delete">${t('删')}</button></form>
    </div>
    <details class="tapp"${d ? ' open' : ''}>
      <summary>${icon('chev', { cls: 'ic chev' })}${t('跳去哪')}</summary>
      <form method="post" action="/today/goals" data-ns="${ns}">
        <input type="hidden" name="task" value="${task.id}">
        ${d && o.error ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''}
        ${schemeField({
          name: 'target', value: d ? d.target : task.target, ns, required: false, labelFor: 'target_label', t,
          label: t('这条子任务跳去哪 · 可不填'),
          placeholder: t('bilibili:// 或 https://…'),
          hint: t('不填就跟着目标走。自定义 scheme 填完点<b>试跳</b>，App 真打开了才算数；https 链接不用试。'),
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
details.app > .card.tasks{border:0;border-top:1px solid var(--rule);border-radius:0;margin:0}
.tl{list-style:none;margin:0 0 10px;padding:0}
.tl li{padding:6px 0;border-bottom:1px solid var(--rule)}
.tl .trow{display:flex;align-items:center;gap:10px}
.tl .tname{flex:1;min-width:0}
.tl .trow form{margin:0}
/* 尺寸、旋转和去掉系统三角都由 icons.ts 的通用 summary 规则管，这里只管排布。
   details.app 那一段之所以还自带一份，是因为它把 .chev 覆写成了 14px。 */
details.tapp > summary{display:flex;align-items:center;gap:6px;min-height:44px;font-size:14px;color:var(--dim)}
/* details.app 在打开时有自己的写法把 summary 变回 --fg；tapp 靠这条补上同一件事。 */
details.tapp[open] > summary{color:var(--fg)}
details.tapp > form{margin:0 0 10px}
/* 目标那一份是 form > details（HTML 里 form 不能套 form，子任务只好反过来），
   所以折叠里直接躺着几个 .field，最后一格的下边距由它自己带。 */
details.tapp > .field:last-child{margin-bottom:10px}
details.tapp > form > .banner{margin:10px 0 14px}
.taskadd{display:flex;gap:8px;align-items:center}
.taskadd input{flex:1;min-width:0}
.card.limit label{margin:0 0 8px}
.limitrow{display:flex;gap:14px;align-items:center}
/* 页面作用域的裸 select，和下面那条 input[type=date] 一个道理：console.ts 的通用
   输入框规则按类型列举，这两种它都没列到。min-height 跟着 44px 的触达底线。 */
select{font:inherit;font-size:16px;line-height:1.4;padding:10px 12px;color:var(--fg);
  background:transparent;border:1px solid var(--rule);border-radius:10px;min-height:44px}
details.archived{margin:24px 0 0}
.arow{display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--rule)}
.arow .sname{flex:1;color:var(--dim)}
button.linky[disabled]{opacity:.35}
input[type=date]{display:block;width:100%;font:inherit;font-size:16px;line-height:1.4;padding:10px 12px;
  color:var(--fg);background:transparent;border:1px solid var(--rule);border-radius:10px}
`
