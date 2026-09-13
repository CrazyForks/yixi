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
import { deleteUserApp, getUserApp, listUserApps, upsertUserApp } from '../db'
import { DEFAULT_THEME, escapeHtml, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { fold, hl, icon } from './icons'
import { forbiddenPrefixes } from '../scheme'
import { inAppBrowserOf, type InAppBrowser } from '../inapp'
import { fieldId, SCHEME_FIELD_CSS, SCHEME_FIELD_JS, schemeField } from './schemefield'


// --- route handler ---------------------------------------------------------

export async function handleSettings(request: Request, env: Env, user: User): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url)
    return await renderSettings(request, env, user, { saved: url.searchParams.get('saved') })
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
    return await renderSettings(request, env, user, { error: '表单没读出来，重试一次。', status: 400 })
  }

  const op = field(form, 'op')
  const rawApp = field(form, 'app')

  if (op === 'delete') {
    const app = validAppKey(rawApp)
    if (!app) return await renderSettings(request, env, user, { error: '要删除的 App 键不对。', status: 400 })
    await deleteUserApp(env.DB, user.id, app)
    return seeOther('/settings')
  }

  if (op !== 'save' && op !== 'add') {
    return await renderSettings(request, env, user, { error: '不认识这个操作。', status: 400 })
  }

  // Adding and editing hit the same upsert, so they have to be told apart here.
  // The add form is now the first thing on the page and its App 键 field is
  // empty every time; typing a key that already exists would otherwise
  // overwrite that row wholesale — including the wait and grace someone tuned
  // on purpose — and the only clue would be the row silently changing further
  // down. /lookup's write path had this guard; /settings never did, and the add
  // form used to be buried at the bottom where nobody reached it by accident.
  if (op === 'add') {
    const key = validAppKey(rawApp)
    if (key !== null && (await getUserApp(env.DB, user.id, key)) !== null) {
      return await renderSettings(request, env, user, {
        error: `已经有一条 ${key} 了。要改它就展开下面那条，别在这里重新加一遍——直接加会把它的秒数一起覆盖掉。`,
        draft: {
          app: rawApp,
          label: field(form, 'label'),
          scheme: field(form, 'scheme'),
          wait: field(form, 'wait_seconds'),
          grace: field(form, 'grace_seconds'),
          enabled: form.has('enabled'),
        },
        draftIsAdd: true,
        status: 409,
      })
    }
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
    // Same reason as the collision branch: a rejected ADD whose key happens to
    // match an existing row must reopen the add form, not that row.
    return await renderSettings(request, env, user, { error: parsed, draft, draftIsAdd: op === 'add', status: 400 })
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
 * Schemes that must never reach `location.href` in the picker or the breathing
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
  /**
   * The draft came from the add form, not from editing a row.
   *
   * Without this the collision case renders wrong in the most misleading way
   * available: `draftMatchesRow` is true precisely because the key is taken, so
   * the typed values would be painted into the EXISTING row's form and that row
   * would spring open — showing the user their new scheme sitting in the row
   * they were told they had not changed.
   */
  draftIsAdd?: boolean
  status?: number
}

async function renderSettings(request: Request, env: Env, user: User, o: RenderOptions): Promise<Response> {
  const apps = await listUserApps(env.DB, user.id)
  const draft = o.draft
  // A rejected edit re-renders from the database, which would silently throw
  // away what the user just typed. When the draft names a row that exists, the
  // draft wins so their input survives the round trip.
  const draftMatchesRow =
    draft !== undefined && o.draftIsAdd !== true && apps.some((a) => a.app === draft.app)
  const addDraft = draftMatchesRow ? undefined : draft

  const rows = apps
    .map((a) =>
      appRow(draftMatchesRow && draft !== undefined && draft.app === a.app ? fromDraft(draft) : a, {
        // A row whose edit was just rejected has to be open, or the reader is
        // looking at an error message about a form they cannot see. It goes
        // through `draftMatchesRow` rather than through `draft.app` directly:
        // an add that collided also carries a draft naming this row, and
        // opening it there would show the reader their new values inside the
        // row they were just told they had not changed.
        open: draftMatchesRow && draft !== undefined && draft.app === a.app,
      }),
    )
    .join('\n')

  const body = `${consoleHeader(user, 'settings')}
<main>
  <h1>要拦哪些 App</h1>
  <p class="lede">每条对应 iPhone 上一条「打开 App 时」自动化。改完立刻生效，不用重建快捷指令。</p>
  ${inAppNotice(inAppBrowserOf(request))}
  ${o.error ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''}
  ${o.saved ? `<p class="banner good">已保存 <span class="mono">${escapeHtml(o.saved)}</span>。</p>` : ''}

  ${addBlock(addDraft)}

  ${apps.length === 0 ? emptyState() : `<h2>已在拦 · ${apps.length}</h2>\n  ${rows}`}
</main>`

  return page({
    title: `设置 · 一息`,
    theme: DEFAULT_THEME,
    css: CONSOLE_CSS + SCHEME_FIELD_CSS + SETTINGS_CSS,
    body,
    script: SCHEME_FIELD_JS,
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

/**
 * Said before the first tap, not after the tenth.
 *
 * 「试跳」 is a `location.href` to a custom scheme, which an app's embedded
 * browser generally refuses — silently. Without this the reader taps, nothing
 * happens, and the only conclusion available is that the scheme is wrong; they
 * then work through every candidate in the list, each failing for a reason that
 * has nothing to do with any of them.
 *
 * The second sentence matters as much as the first: the interception itself is
 * unaffected, because the Shortcut opens the system default browser. Without
 * saying so, this notice reads as 「这个工具在微信里坏了」 rather than 「这一步
 * 要换个浏览器做」.
 */
function inAppNotice(host: InAppBrowser | null): string {
  if (host === null) return ''
  const name = escapeHtml(host.name)
  return `<p class="banner warn">${icon('caveat')}<span>你现在是在<b>${name}</b>内置的浏览器里。它不让网页跳去别的 App，所以这一页的
    <b>试跳</b>按不出反应——<b>不是你的 scheme 填错了</b>。${escapeHtml(host.escape)}，用 Safari 打开这一页再试。
    <br>真正拦你的时候不受影响：快捷指令打开的是系统默认浏览器，不经过${name}。</span></p>`
}

function emptyState(): string {
  return `<p class="empty">还没有配置任何 App。<br>用上面的 ${icon('plus')} 加第一个。</p>`
}

// --- add ------------------------------------------------------------------

/** Namespace for the add form's ids; APP_KEY forbids uppercase, so no real app key can collide with it. */
const NEW_NS = 'NEW'

/**
 * Adding is the first thing on the page and costs one tap when closed.
 *
 * It used to sit under every configured app, below a horizontal rule and a
 * paragraph — so on a phone with three apps configured, the way to add a fourth
 * was to scroll past three fully-expanded forms. Nothing about that order was
 * deliberate; it is just where the form was written.
 *
 * `open` only when a rejected submission has to be shown, because a form that
 * springs open on every visit is the layout this replaces.
 */
function addBlock(draft?: Draft): string {
  const d = draft
  return `<details class="add"${d ? ' open' : ''}>
  <summary class="addbtn">${icon('plus', { cls: 'ic lg' })}<span>加一个 App</span></summary>
  <form class="card addform" method="post" action="/settings" data-ns="${NEW_NS}">
  <div class="field">
    <label for="f-new-app">App 键 · 自动化里要手打的那行文本，小写</label>
    <input id="f-new-app" type="text" name="app" value="${escapeHtml(d?.app ?? '')}" placeholder="xhs" required
      inputmode="latin" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="32" pattern="[a-z0-9_-]{1,32}">
  </div>
  ${labelField(d?.label ?? '', NEW_NS)}
  ${schemeField({
    name: 'scheme',
    value: d?.scheme ?? '',
    ns: NEW_NS,
    label: 'URL scheme · 点「继续」时用它跳回 App，<b>务必先实测</b>',
    labelFor: 'label',
  })}
  ${secondsFields(
    d ? (int(d.wait, DEFAULT_WAIT_SECONDS) ?? DEFAULT_WAIT_SECONDS) : DEFAULT_WAIT_SECONDS,
    d ? (int(d.grace, DEFAULT_GRACE_SECONDS) ?? DEFAULT_GRACE_SECONDS) : DEFAULT_GRACE_SECONDS,
    NEW_NS,
  )}
  ${enabledField(d ? d.enabled : true, NEW_NS)}
  <div class="actions">
    <button class="primary" type="submit" name="op" value="add">添加</button>
  </div>
  </form>
</details>`
}

// --- one configured app ---------------------------------------------------

/**
 * Collapsed to one line, because that is what the reader came for.
 *
 * Every configured app used to render its whole form open — four inputs, a
 * checkbox, a paragraph and three buttons, roughly a phone screen each. Three
 * apps meant three screens of editable fields to scroll past in order to read
 * a list of three names, and the numbers you wanted to check were buried among
 * the controls that change them.
 *
 * The summary carries what you check without editing: name, the app key the
 * automation has to match, and both intervals. Opening it is one tap, and the
 * `id` is unchanged so `/setup` and old `#app-xhs` links still land here.
 */
function appRow(a: Omit<UserApp, 'user_id'>, o: { open: boolean }): string {
  const key = escapeHtml(a.app)
  const off = a.enabled ? '' : ' off'
  return `<details class="app${off}" id="app-${key}"${o.open ? ' open' : ''}>
  <summary>
    <span class="sname">${escapeHtml(a.label)}</span>
    <span class="skey mono">${key}</span>
    ${
      a.enabled
        ? `<span class="mini">${icon('clock')}<span class="num">${a.wait_seconds}</span>s ${icon('loop')}<span class="num">${a.grace_seconds}</span>s</span>`
        : '<span class="badge">已停用</span>'
    }
    ${icon('chev', { cls: 'ic chev' })}
  </summary>
  <form class="card" method="post" action="/settings" data-ns="${key}">
  <input type="hidden" name="app" value="${escapeHtml(a.app)}">
  ${labelField(a.label, a.app)}
  ${schemeField({
    name: 'scheme',
    value: a.scheme,
    ns: a.app,
    label: 'URL scheme · 点「继续」时用它跳回 App，<b>务必先实测</b>',
    labelFor: 'label',
  })}
  ${secondsFields(a.wait_seconds, a.grace_seconds, a.app)}
  ${enabledField(a.enabled === 1, a.app)}
  <div class="actions">
    <button class="primary" type="submit" name="op" value="save">保存</button>
    <button class="linky danger" type="submit" name="op" value="delete" formnovalidate onclick="return confirm('删掉这条配置？已经记下的次数不会被删。')">删除</button>
  </div>
  </form>
</details>`
}

function labelField(value: string, ns: string): string {
  const id = fieldId(ns, 'label')
  return `<div class="field">
    <label for="${id}">显示名 · 呼吸页上会看到</label>
    <input id="${id}" type="text" name="label" value="${escapeHtml(value)}" placeholder="小红书" required maxlength="40">
  </div>`
}

// schemeField() moved to ./schemefield.ts, which /goals also needs.

/**
 * The two numbers, and the one sentence about them that may not be deleted.
 *
 * The claim that costs the reader something when it is missed — too short a
 * window and you are intercepted the instant you land — keeps a permanently
 * visible line, in the same closed-loop mark the field label wears. The
 * background (what the window is for, why those triggers do not enter the
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

// fieldId() moved to ./schemefield.ts, which computes the same
// `f-${ns}-${name}` formula for its own input. The key is validated against
// APP_KEY, so it is always id-safe.

/*
 * The icon in a <label> stays inline rather than turning the label into a flex
 * row: two of these labels carry a <b> inside their prose, and as flex items a
 * text run and its <b> get pulled apart by the row gap.
 */
const SETTINGS_CSS = `
.field label .ic{width:15px;height:15px;color:var(--faint);margin-right:5px}

h2{margin:0 0 12px}
`
