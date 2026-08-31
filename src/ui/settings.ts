// /settings — the page that makes 一息 a multi-user product rather than one
// person's database.
//
// Without it, changing a wait from 10s to 15s means someone SSH-ing into a D1
// console on your behalf. With it, a friend who was handed a token owns their
// own configuration completely and never has to ask.
//
// Plain HTML forms, POST/redirect/GET, no client-side framework and no fetch:
// this is opened on a phone, one-handed, usually to change a single number.
//

import type { Env, User, UserApp } from '../types'
import { DEFAULT_GRACE_SECONDS, DEFAULT_WAIT_SECONDS } from '../types'
import { deleteUserApp, listUserApps, upsertUserApp } from '../db'
import { DEFAULT_THEME, escapeHtml, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { fold, hl, icon } from './icons'
import { forbiddenPrefixes } from '../scheme'


// --- route handler ---------------------------------------------------------

export async function handleSettings(request: Request, env: Env, user: User): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url)
    return await renderSettings(env, user, { saved: url.searchParams.get('saved') })
  }
  if (request.method === 'POST') return await handlePost(request, env, user)
  return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST' } })
}

/**
 * Every write is a POST followed by a 303 back to GET /settings, so a pull-to-
 * refresh on a phone can never re-submit the form. `?saved=` carries only the
 * app key, which the user just typed themselves.
 */
async function handlePost(request: Request, env: Env, user: User): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return await renderSettings(env, user, { error: '表单没读出来，重试一次。', status: 400 })
  }

  const op = field(form, 'op')
  const rawApp = field(form, 'app')

  if (op === 'delete') {
    const app = validAppKey(rawApp)
    if (!app) return await renderSettings(env, user, { error: '要删除的 App 键不对。', status: 400 })
    await deleteUserApp(env.DB, user.id, app)
    return seeOther('/settings')
  }

  if (op !== 'save') {
    return await renderSettings(env, user, { error: '不认识这个操作。', status: 400 })
  }

  const draft: Draft = {
    app: rawApp,
    label: field(form, 'label'),
    scheme: field(form, 'scheme'),
    wait: field(form, 'wait_seconds'),
    grace: field(form, 'grace_seconds'),
    enabled: form.has('enabled'),
  }

  const parsed = validate(draft)
  if (typeof parsed === 'string') {
    return await renderSettings(env, user, { error: parsed, draft, status: 400 })
  }

  await upsertUserApp(env.DB, { user_id: user.id, ...parsed })
  return seeOther(`/settings?saved=${encodeURIComponent(parsed.app)}`)
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } })
}

// --- validation ------------------------------------------------------------

interface Draft {
  app: string
  label: string
  scheme: string
  wait: string
  grace: string
  enabled: boolean
}

/**
 * Lowercase only, deliberately. The app key has to be retyped by hand inside an
 * iOS automation, where a mismatch fails silently — the Shortcut runs, the gate
 * says "not watching this one", and the user just never gets intercepted. Making
 * `XHS` a visible validation error here is cheaper than that debugging session.
 */
const APP_KEY = /^[a-z0-9_-]{1,32}$/

/** `scheme:` — anything RFC 3986 would accept as a scheme, plus its colon. */
const SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * Schemes that must never reach `location.href` on /probe or the breathing
 * page. This is the user's own account, so the realistic threat is a
 * copy-pasted line from a forum rather than an attacker — but a page whose
 * whole job is to navigate to a string from the database has no business
 * navigating to `javascript:`.
 */


/**
 * Below this the return trip does not fit: tap 继续 → Safari hands off → the app
 * cold-starts → the automation fires again. Somewhere in there the window has to
 * still be open, or the user lands back in the breathing page they just left.
 */
const MIN_GRACE_SECONDS = 30

function validAppKey(raw: string): string | null {
  return APP_KEY.test(raw) ? raw : null
}

/** Returns the row to write, or a Chinese error message to show the user. */
function validate(d: Draft): Omit<UserApp, 'user_id'> | string {
  const app = validAppKey(d.app)
  if (!app) return 'App 键只能用小写字母、数字、- 和 _，最长 32 位。它要和你在快捷指令自动化里手打的那行文本一模一样。'

  if (d.label.length === 0) return '显示名不能空着。'
  if (d.label.length > 40) return '显示名太长了，40 个字以内。'

  if (d.scheme.length === 0) return 'URL scheme 不能空着。不知道填什么就先随便填一个候选，再去「实测」页试。'
  if (d.scheme.length > 200) return 'URL scheme 太长了。'
  if (!SCHEME_PREFIX.test(d.scheme)) return 'URL scheme 要长成 xxx:// 的样子，比如 someapp://。'
  const lower = d.scheme.toLowerCase()
  if (forbiddenPrefixes().some((bad) => lower.startsWith(bad))) return '这个 scheme 不能用。'

  const wait = int(d.wait, DEFAULT_WAIT_SECONDS)
  if (wait === null || wait < 1 || wait > 120) return '等待秒数要是 1 到 120 之间的整数。'

  const grace = int(d.grace, DEFAULT_GRACE_SECONDS)
  // The floor is not cosmetic. Tapping 继续 has to survive Safari handing off,
  // the app cold-starting, and the automation firing again on the way in — a
  // few seconds of real time. Set it below that and the user is intercepted
  // again the moment they arrive, which reads as the tool being broken.
  if (grace === null || grace < MIN_GRACE_SECONDS || grace > 3600) {
    return `免打扰秒数要是 ${MIN_GRACE_SECONDS} 到 3600 之间的整数。太短会让你刚跳回 App 就又被拦。`
  }

  return {
    app,
    label: d.label,
    scheme: d.scheme,
    wait_seconds: wait,
    grace_seconds: grace,
    enabled: d.enabled ? 1 : 0,
  }
}

function field(form: FormData, key: string): string {
  const v = form.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

function int(raw: string, fallback: number): number | null {
  if (raw === '') return fallback
  if (!/^-?\d+$/.test(raw)) return null
  return Number(raw)
}

// --- render ----------------------------------------------------------------

interface RenderOptions {
  error?: string
  saved?: string | null
  draft?: Draft
  status?: number
}

async function renderSettings(env: Env, user: User, o: RenderOptions): Promise<Response> {
  const apps = await listUserApps(env.DB, user.id)
  const draft = o.draft
  // A rejected edit re-renders from the database, which would silently throw
  // away what the user just typed. When the draft names a row that exists, the
  // draft wins so their input survives the round trip.
  const draftMatchesRow = draft !== undefined && apps.some((a) => a.app === draft.app)

  const cards = apps
    .map((a) => appCard(draftMatchesRow && draft !== undefined && draft.app === a.app ? fromDraft(draft) : a))
    .join('\n')

  const body = `${consoleHeader(user, 'settings')}
<main>
  <h1>要拦哪些 App</h1>
  <p class="lede">每条配置对应 iPhone 上的一条「打开 App 时」自动化。<b>App 键</b>就是你在那条自动化里手打的那行文本，必须一字不差。改完立刻生效，不用重建快捷指令。</p>
  ${o.error ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''}
  ${o.saved ? `<p class="banner good">已保存 <span class="mono">${escapeHtml(o.saved)}</span>。</p>` : ''}
  ${apps.length === 0 ? emptyState() : cards}
  <hr class="sep">
  <h2>加一个</h2>
  <p class="note">还不知道 URL scheme 也没关系：去<a href="/lookup">候选</a>页输入 App 名字，那里会列出可试的候选并标明来源，同一页往下就能试跳，跳通了直接写进这里。</p>
  ${addCard(draftMatchesRow ? undefined : draft)}
</main>`

  return page({
    title: `设置 · 一息`,
    theme: DEFAULT_THEME,
    css: CONSOLE_CSS + SETTINGS_CSS,
    body,
    status: o.status ?? 200,
  })
}

function fromDraft(d: Draft): Omit<UserApp, 'user_id'> {
  return {
    app: d.app,
    label: d.label,
    scheme: d.scheme,
    wait_seconds: int(d.wait, DEFAULT_WAIT_SECONDS) ?? DEFAULT_WAIT_SECONDS,
    grace_seconds: int(d.grace, DEFAULT_GRACE_SECONDS) ?? DEFAULT_GRACE_SECONDS,
    enabled: d.enabled ? 1 : 0,
  }
}

function emptyState(): string {
  return `<p class="empty">还没有配置任何 App。<br>先在下面加一个，再去 iPhone 的「快捷指令」建自动化。</p>`
}

function appCard(a: Omit<UserApp, 'user_id'>): string {
  const key = escapeHtml(a.app)
  const off = a.enabled ? '' : ' off'
  return `<form class="card${off}" id="app-${key}" method="post" action="/settings">
  <div class="card-head">
    <span class="name">${escapeHtml(a.label)}</span>
    <span class="key">${key}</span>
    ${a.enabled ? '' : '<span class="badge">已停用</span>'}
  </div>
  <input type="hidden" name="app" value="${escapeHtml(a.app)}">
  ${labelField(a.label, a.app)}
  ${schemeField(a.scheme, a.app)}
  ${secondsFields(a.wait_seconds, a.grace_seconds, a.app)}
  ${enabledField(a.enabled === 1, a.app)}
  <div class="actions">
    <button class="primary" type="submit" name="op" value="save">保存</button>
    <a class="linky go" href="/lookup#app-${key}">${icon('jump')}去实测这个 scheme</a>
    <button class="linky danger" type="submit" name="op" value="delete" formnovalidate onclick="return confirm('删掉这条配置？已经记下的次数不会被删。')">删除</button>
  </div>
</form>`
}

/** Namespace for the add form's ids; APP_KEY forbids uppercase, so no real app key can collide with it. */
const NEW_NS = 'NEW'

function addCard(draft?: Draft): string {
  const d = draft
  return `<form class="card" method="post" action="/settings">
  <div class="field">
    <label for="f-new-app">App 键 · 自动化里要手打的那行文本，小写</label>
    <input id="f-new-app" type="text" name="app" value="${escapeHtml(d?.app ?? '')}" placeholder="xhs" required
      inputmode="latin" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="32" pattern="[a-z0-9_-]{1,32}">
  </div>
  ${labelField(d?.label ?? '', NEW_NS)}
  ${schemeField(d?.scheme ?? '', NEW_NS)}
  ${secondsFields(
    d ? (int(d.wait, DEFAULT_WAIT_SECONDS) ?? DEFAULT_WAIT_SECONDS) : DEFAULT_WAIT_SECONDS,
    d ? (int(d.grace, DEFAULT_GRACE_SECONDS) ?? DEFAULT_GRACE_SECONDS) : DEFAULT_GRACE_SECONDS,
    NEW_NS,
  )}
  ${enabledField(d ? d.enabled : true, NEW_NS)}
  <div class="actions">
    <button class="primary" type="submit" name="op" value="save">添加</button>
  </div>
</form>`
}

function labelField(value: string, ns: string): string {
  const id = fieldId(ns, 'label')
  return `<div class="field">
    <label for="${id}">显示名 · 呼吸页上会看到</label>
    <input id="${id}" type="text" name="label" value="${escapeHtml(value)}" placeholder="小红书" required maxlength="40">
  </div>`
}

function schemeField(value: string, ns: string): string {
  const id = fieldId(ns, 'scheme')
  return `<div class="field">
    <label for="${id}">URL scheme · 点「继续」时用它跳回 App，<b>务必先实测</b></label>
    <input id="${id}" type="text" name="scheme" value="${escapeHtml(value)}" placeholder="someapp://" required
      inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="200" class="mono">
  </div>`
}

/**
 * The two numbers, and the one sentence about them that may not be deleted.
 *
 * This block renders once per configured app plus once for the add form, so the
 * old three-clause paragraph was the single most repeated piece of prose in the
 * product. The claim that costs the reader something when it is missed — too
 * short a window and you are intercepted the instant you land — keeps a
 * permanently visible line, in the same closed-loop mark the field label wears.
 * The background (what the window is for, why those triggers do not enter the
 * statistics) is one tap away.
 */
function secondsFields(wait: number, grace: number, ns: string): string {
  const w = fieldId(ns, 'wait')
  const g = fieldId(ns, 'grace')
  return `<div class="row">
    <div class="field">
      <label for="${w}">${icon('clock')}等待 · 秒</label>
      <input id="${w}" type="number" name="wait_seconds" value="${wait}" min="1" max="120" step="1" inputmode="numeric" required>
    </div>
    <div class="field">
      <label for="${g}">${icon('loop')}免打扰 · 秒</label>
      <input id="${g}" type="number" name="grace_seconds" value="${grace}" min="30" max="3600" step="1" inputmode="numeric" required>
    </div>
  </div>
  <div class="hint">
    ${hl('loop', '「免打扰」建议 <span class="num">90</span> 秒。设得太短（几秒）会让你<b>刚跳回 App 就又被拦</b>。')}
    ${fold(
      '它到底管什么',
      '<p>点了「继续」之后这段时间内不再拦你。它同时解决了跳回 App 会再次触发自动化的死循环——这段时间内的触发算机器噪音，不进统计。</p>',
    )}
  </div>`
}

function enabledField(on: boolean, ns: string): string {
  const id = fieldId(ns, 'enabled')
  return `<div class="check">
    <input id="${id}" type="checkbox" name="enabled" value="1"${on ? ' checked' : ''}>
    <label for="${id}">启用拦截</label>
  </div>`
}

/**
 * The same field set is rendered once per configured app plus once for the add
 * form. Namespacing every id by the app key keeps `<label for>` pointing at its
 * own input — without it, three apps that all wait 10 seconds would emit three
 * inputs sharing one id, and tapping the third label would focus the first.
 * The key is validated against APP_KEY, so it is always id-safe.
 */
function fieldId(ns: string, name: string): string {
  return `f-${ns}-${name}`
}

/*
 * The icon in a <label> stays inline rather than turning the label into a flex
 * row: two of these labels carry a <b> inside their prose, and as flex items a
 * text run and its <b> get pulled apart by the row gap.
 */
const SETTINGS_CSS = `
.field label .ic{width:15px;height:15px;color:var(--faint);margin-right:5px}
.hint{font-size:14px;line-height:1.75;color:var(--dim);margin:0 0 15px}
.hint b{color:var(--fg)}
.hint .ic{color:var(--dim)}
a.linky.go{display:inline-flex;align-items:center;gap:6px}
`
