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
import { fold, hl, icon, seal } from './icons'
import { forbiddenPrefixes, forbiddenSchemePattern } from '../scheme'


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

  if (op !== 'save' && op !== 'add') {
    return await renderSettings(env, user, { error: '不认识这个操作。', status: 400 })
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
      return await renderSettings(env, user, {
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
    return await renderSettings(env, user, { error: parsed, draft, draftIsAdd: op === 'add', status: 400 })
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

async function renderSettings(env: Env, user: User, o: RenderOptions): Promise<Response> {
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
  ${o.error ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''}
  ${o.saved ? `<p class="banner good">已保存 <span class="mono">${escapeHtml(o.saved)}</span>。</p>` : ''}

  ${addBlock(addDraft)}

  ${apps.length === 0 ? emptyState() : `<h2>已在拦 · ${apps.length}</h2>\n  ${rows}`}
</main>`

  return page({
    title: `设置 · 一息`,
    theme: DEFAULT_THEME,
    css: CONSOLE_CSS + SETTINGS_CSS,
    body,
    script: SETTINGS_JS,
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
  ${schemeField(d?.scheme ?? '', NEW_NS)}
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
  ${schemeField(a.scheme, a.app)}
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

/**
 * The scheme field, and everything the 「候选」 tab used to be.
 *
 * That tab was a destination: you had to know it existed, guess what 「候选」
 * meant, and go there BEFORE filling in the form that needed the answer — and
 * if you went mid-form, the form was gone when you came back. Its two jobs both
 * belong to this one input, so they live on it now:
 *
 *   - 「试跳」 beside the box, which jumps to whatever is currently in it. One
 *     button covers a candidate you just picked, a scheme you saved months ago,
 *     and a line you pasted from a forum — the three things the standalone
 *     probe page did with three separate controls.
 *   - a folded search that lists candidates inline and writes the chosen one
 *     into the box, without a navigation and without touching the server.
 *
 * The two worked examples above the fold are load-bearing, not decoration: the
 * reader's actual question is 「这个格子里该填什么形状的东西」, and one real
 * answer settles it faster than any explanation of where to look it up.
 */
function schemeField(value: string, ns: string): string {
  const id = fieldId(ns, 'scheme')
  return `<div class="field scheme">
    <label for="${id}">URL scheme · 点「继续」时用它跳回 App，<b>务必先实测</b></label>
    <div class="withtry">
      <input id="${id}" type="text" name="scheme" value="${escapeHtml(value)}" placeholder="someapp://" required
        inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="200" class="mono sc">
      <button class="try" type="button" data-try>${icon('jump')}试跳</button>
    </div>
    <p class="hint ex">${hl(
      'caveat',
      '例：小红书 <code class="mono">xhsdiscover://</code>，起点读书 <code class="mono">QDReader://</code>。' +
        '候选都<b>没验证过</b>，填完必须点<b>试跳</b>，App 真打开了才算数。',
    )}</p>
    ${fold(
      '不知道填什么？按 App 名字找',
      `<div class="pick">
        <div class="manual">
          <input type="text" class="pq" placeholder="起点读书" maxlength="40"
            inputmode="search" autocapitalize="none" autocorrect="off" spellcheck="false"
            aria-label="按 App 名字搜索候选">
          <button type="button" class="pgo">${icon('lookup')}找</button>
        </div>
        <div class="pout" role="status" aria-live="polite"></div>
      </div>`,
      'pickwrap',
    )}
  </div>`
}

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
.hint code{font-size:.92em;background:var(--rule);border-radius:4px;padding:.1em .36em}
.hint.ex{margin:9px 0 0;font-size:13px;line-height:1.7;color:var(--faint)}
.hint.ex b{color:var(--dim)}
.hint.ex code{font-size:.95em}

/* --- add, at the top, one tap when closed --- */
.add{margin:0 0 22px}
.add > summary.addbtn{
  display:flex;align-items:center;justify-content:center;gap:9px;
  border:1px dashed var(--rule);border-radius:14px;padding:15px;
  color:var(--dim);font-size:16px;letter-spacing:.04em;cursor:pointer;list-style:none;
}
.add > summary.addbtn::-webkit-details-marker{display:none}
.add > summary.addbtn::marker{content:""}
.add > summary.addbtn:active{opacity:.7}
.add[open] > summary.addbtn{
  border-style:solid;color:var(--fg);border-radius:14px 14px 0 0;border-bottom:0;padding:14px 16px;
  justify-content:flex-start;
}
.add[open] > summary.addbtn .ic{transform:rotate(45deg);transition:transform .18s ease}
.add > .addform{border-radius:0 0 14px 14px;margin:0}

/* --- one configured app, collapsed to a line --- */
h2{margin:0 0 12px}
details.app{margin:0 0 10px;border:1px solid var(--rule);border-radius:14px;overflow:hidden}
details.app.off{opacity:.62}
details.app > summary{
  display:flex;align-items:baseline;gap:9px;padding:14px 16px;
  cursor:pointer;list-style:none;
}
details.app > summary::-webkit-details-marker{display:none}
details.app > summary::marker{content:""}
details.app > summary:active{background:var(--ring-track)}
details.app[open] > summary{border-bottom:1px solid var(--rule)}
.sname{font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto}
.skey{font-size:13px;color:var(--faint);flex:0 0 auto}
.mini{margin-left:auto;flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;
  font-size:13px;color:var(--faint);white-space:nowrap}
.mini .ic{width:14px;height:14px}
.mini .ic:not(:first-child){margin-left:5px}
details.app > summary .badge{margin-left:auto}
/* Without this nothing on a collapsed row says it opens. The row went from
   「a form you scroll past」 to 「a line you tap」, and a line that looks like
   plain text is a line nobody taps. */
details.app > summary .chev{flex:0 0 auto;width:14px;height:14px;color:var(--faint);
  margin-left:8px;transition:transform .18s ease}
details.app[open] > summary .chev{transform:rotate(90deg)}
/* The form inside carries the card's padding but not its border — the <details>
   is the card now, so a second outline would draw a box inside a box. */
details.app > form.card{border:0;border-radius:0;margin:0}

/* --- scheme field: probe button beside the box --- */
.withtry{display:flex;gap:8px;align-items:stretch}
.withtry input{flex:1;min-width:0}
button.try{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
  background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  border-radius:10px;padding:0 15px;font-size:15px;font-weight:600;min-height:44px;
}
button.try:active{opacity:.72}
button.try .ic{width:16px;height:16px}

/* --- the inline candidate picker --- */
/* This is the discoverability fix, so it may not look like a footnote: the
   whole complaint was that nobody could tell what the 「候选」 tab was for.
   Its own outline, and 「dim」 rather than 「faint」. */
details.pickwrap{margin:12px 0 0}
details.pickwrap > summary{border:1px solid var(--rule);border-radius:9px;
  padding:9px 12px;font-size:14px;letter-spacing:0;color:var(--dim);width:100%;
  box-sizing:border-box}
details.pickwrap > summary:active{opacity:.7}
details.pickwrap[open] > summary{color:var(--fg)}
details.pickwrap > summary .ic.chev{width:13px;height:13px}
.pick{margin:10px 0 0}
.manual{display:flex;gap:8px;align-items:stretch}
.manual input{flex:1;min-width:0}
.manual button{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
  background:transparent;color:var(--fg);border:1px solid var(--rule);
  border-radius:10px;padding:0 15px;font-size:15px;font-weight:600;min-height:44px;
}
.manual button:active{opacity:.72}
.manual button[disabled]{opacity:.5}
.pout{margin:12px 0 0}
.pmsg{margin:0;font-size:13px;line-height:1.75;color:var(--faint)}
.pmsg b{color:var(--fg)}
.phit{margin:0 0 6px;font-size:14px;color:var(--dim)}
.phit b{color:var(--fg)}
.phit .why{color:var(--faint);font-size:13px}
.cd{border-top:1px solid var(--rule);padding:12px 0 4px;margin:0}
.cd:first-of-type{border-top:0}
.cd-h{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 8px}
.cd-sc{word-break:break-all;font-size:15px;-webkit-user-select:all;user-select:all}
.sig{display:inline-flex;align-items:center;gap:5px;font-size:12px;letter-spacing:.06em;
  white-space:nowrap;color:var(--dim)}
.t-verified .sig{color:var(--fg)}
.t-derived .sig{color:var(--danger)}
.marks{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.mk{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dim);
  text-decoration:none;border:1px solid var(--rule);border-radius:4px;padding:1.5px 9px;white-space:nowrap}
.mk.when{font-variant-numeric:tabular-nums;letter-spacing:.04em}
.cd .evidence{margin:0 0 8px;font-size:13px;color:var(--dim);line-height:1.6}
.cd .caveat{margin:0 0 8px;font-size:13px;color:var(--faint);line-height:1.6}
.cdacts{display:flex;gap:8px;align-items:stretch;margin:0 0 4px}
.cdacts button{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  border-radius:8px;font-size:15px;font-weight:600;min-height:46px;padding:0 10px}
.cdacts .ctry{background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border)}
.cdacts .cuse{background:transparent;color:var(--fg);border:1px solid var(--rule)}
.cdacts button:active{opacity:.72}
.ord{display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:18px;height:18px;border-radius:3px;border:1px solid currentColor;
  font-family:var(--num);font-size:12px;font-weight:400;opacity:.72}
.perr{margin:8px 0 0;font-size:13px;color:var(--danger);line-height:1.7}
`

/**
 * Icon markup the client-side renderer needs, resolved server-side.
 *
 * The alternative was a second copy of the SVG path data in a template string,
 * which is how the two-copies-of-the-denylist problem started. `icon()` stays
 * the only place any of this geometry is written down.
 */
const PICK_ICONS = JSON.stringify({
  jump: icon('jump'),
  save: icon('save'),
  source: icon('source'),
  agree: icon('agree'),
  clock: icon('clock'),
  verified: seal('verified'),
  listed: seal('listed'),
  derived: seal('derived'),
})

/**
 * Three jobs, and the first one is a hard requirement rather than a style.
 *
 * 1. THE JUMP. `location.href` assigned synchronously inside a click handler is
 *    the same gesture-stack navigation the breathing page's 「继续」 performs. An
 *    `<a href>`, a `setTimeout`, or anything reached after an `await` is a
 *    different mechanism in Safari and would certify schemes that then fail in
 *    the one place it counts. Delegation is fine — a bubbled click is still the
 *    same synchronous dispatch — but nothing may be awaited on the way.
 *
 *    `BAD` repeats the denylist the write path already enforces, because this
 *    box accepts anything the reader types, including a line pasted from a
 *    forum, and a derived candidate is assembled from a string Apple returned.
 *
 * 2. THE DRAFT. A jump leaves the page. Coming back from the app, Safari
 *    usually still has it — but "usually" is not good enough when what is at
 *    stake is a half-filled form the reader cannot reconstruct. So every jump
 *    writes the form to localStorage first (synchronously, before the
 *    assignment), and a load restores it once and deletes it. Submitting clears
 *    it too, or a stale draft would overwrite the row that was just saved.
 *
 * 3. THE PICKER. Search hits /api/candidates and renders inline; 「用这个」 is
 *    pure DOM, no navigation and no server round trip. That is the entire
 *    reason this stopped being a separate page: the reader is standing in the
 *    form, and taking them away from it to answer one field was the bug.
 */
const SETTINGS_JS = `
(function () {
  var BAD = /${forbiddenSchemePattern()}/i;
  var OK = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
  var ICONS = ${PICK_ICONS};
  var TIER = { verified: '实测过', listed: '清单里有', derived: '猜的' };
  var DRAFT_TTL = 30 * 60 * 1000;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function jump(scheme) {
    if (!scheme || !OK.test(scheme) || BAD.test(scheme)) return false;
    location.href = scheme;
    return true;
  }

  // --- draft ---------------------------------------------------------------

  function key(ns) { return 'yixi.draft.' + ns; }

  function fieldsOf(form) {
    return {
      app: form.querySelector('[name=app]'),
      label: form.querySelector('[name=label]'),
      scheme: form.querySelector('[name=scheme]'),
      wait: form.querySelector('[name=wait_seconds]'),
      grace: form.querySelector('[name=grace_seconds]'),
      enabled: form.querySelector('[name=enabled]'),
      pq: form.querySelector('.pq')
    };
  }

  function saveDraft(form) {
    var ns = form.getAttribute('data-ns');
    if (!ns) return;
    var f = fieldsOf(form);
    try {
      localStorage.setItem(key(ns), JSON.stringify({
        at: Date.now(),
        app: f.app ? f.app.value : '',
        label: f.label ? f.label.value : '',
        scheme: f.scheme ? f.scheme.value : '',
        wait: f.wait ? f.wait.value : '',
        grace: f.grace ? f.grace.value : '',
        enabled: f.enabled ? !!f.enabled.checked : true,
        pq: f.pq ? f.pq.value : ''
      }));
    } catch (e) { /* private mode, or storage disabled — the jump still matters more */ }
  }

  function clearDraft(form) {
    var ns = form.getAttribute('data-ns');
    if (!ns) return;
    try { localStorage.removeItem(key(ns)); } catch (e) {}
  }

  function restoreDrafts() {
    var forms = document.querySelectorAll('form[data-ns]');
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var ns = form.getAttribute('data-ns');
      var raw = null;
      try { raw = localStorage.getItem(key(ns)); } catch (e) { continue; }
      if (!raw) continue;
      try { localStorage.removeItem(key(ns)); } catch (e) {}
      var d;
      try { d = JSON.parse(raw); } catch (e) { continue; }
      if (!d || typeof d.at !== 'number' || Date.now() - d.at > DRAFT_TTL) continue;

      var f = fieldsOf(form);
      if (f.app && !f.app.readOnly && f.app.type !== 'hidden') f.app.value = d.app || '';
      if (f.label) f.label.value = d.label || '';
      if (f.scheme) f.scheme.value = d.scheme || '';
      if (f.wait && d.wait) f.wait.value = d.wait;
      if (f.grace && d.grace) f.grace.value = d.grace;
      if (f.enabled) f.enabled.checked = !!d.enabled;
      if (f.pq && d.pq) f.pq.value = d.pq;

      // Open every ancestor <details> so the restored form is actually visible;
      // silently refilling a collapsed form would look like nothing happened.
      var node = form.parentNode;
      while (node && node !== document.body) {
        if (node.tagName === 'DETAILS') node.open = true;
        node = node.parentNode;
      }
    }
  }

  // --- picker rendering ----------------------------------------------------

  function marksOf(c) {
    var out = [];
    if (c.confidence === 'verified' && c.verifiedOn) {
      out.push('<span class="mk when">' + ICONS.clock + esc(c.verifiedOn) + '</span>');
    }
    if (c.corroborated) out.push('<span class="mk">' + ICONS.agree + '两份清单一致</span>');
    var srcs = c.sources || [];
    for (var i = 0; i < srcs.length; i++) {
      var u = String(srcs[i].url || '');
      // Only http(s) reaches an href. These strings come from our own table
      // today, but that is a property of the data, not of this renderer.
      if (!/^https?:\\/\\//i.test(u)) continue;
      out.push('<a class="mk" href="' + esc(u) + '" rel="noreferrer">' + ICONS.source + esc(srcs[i].label) + '</a>');
    }
    return out.length ? '<div class="marks">' + out.join('') + '</div>' : '';
  }

  function candidateHtml(c, appName) {
    var tier = TIER[c.confidence] || c.confidence;
    var sealIcon = ICONS[c.confidence] || '';
    return '<div class="cd t-' + esc(c.confidence) + '">' +
      '<div class="cd-h"><span class="sig">' + sealIcon + esc(tier) + '</span>' +
        '<code class="mono cd-sc">' + esc(c.scheme) + '</code></div>' +
      marksOf(c) +
      (c.verifiedNote ? '<p class="evidence">' + esc(c.verifiedNote) + '</p>' : '') +
      (c.caveat ? '<p class="caveat">' + esc(c.caveat) + '</p>' : '') +
      '<div class="cdacts">' +
        '<button type="button" class="ctry" data-scheme="' + esc(c.scheme) + '">' +
          '<span class="ord">1</span>' + ICONS.jump + '试跳' + '</button>' +
        '<button type="button" class="cuse" data-scheme="' + esc(c.scheme) + '" data-label="' + esc(appName) + '">' +
          '<span class="ord">2</span>' + ICONS.save + '用这个' + '</button>' +
      '</div></div>';
  }

  function hitsHtml(data) {
    var parts = [];
    if (data.state === 'derived') {
      parts.push('<p class="pmsg">表里没有这个 App。下面几条是<b>从 App Store 的 bundle id 猜出来的</b>，' +
        '没人验证过 —— 一定要先试跳。</p>');
    }
    for (var i = 0; i < data.hits.length; i++) {
      var h = data.hits[i];
      parts.push('<p class="phit"><b>' + esc(h.name) + '</b>' +
        (h.key ? ' <span class="why">建议 App 键 ' + esc(h.key) + '</span>' : '') + '</p>');
      for (var j = 0; j < h.candidates.length; j++) {
        parts.push(candidateHtml(h.candidates[j], h.name));
      }
    }
    return parts.join('');
  }

  var UNCHECKED = {
    refused: 'App Store 拒了我们这次查询（它会拒绝 Cloudflare 的出口地址）。表里没有的 App 只能自己找 scheme。',
    timeout: '连 App Store 超时了。过一会儿再试，或者自己填一个 scheme 直接试跳。',
    unreadable: 'App Store 返回的内容看不懂。自己填一个 scheme 直接试跳也行。',
    'too-short': '名字太短了，多打几个字。'
  };

  function render(out, data) {
    if (data.state === 'table' || data.state === 'derived') { out.innerHTML = hitsHtml(data); return; }
    if (data.state === 'unknown') {
      out.innerHTML = '<p class="pmsg">没找到这个 App。' +
        '可以自己在上面的格子里填一个 scheme，再点<b>试跳</b>试试。</p>';
      return;
    }
    if (data.state === 'unchecked') {
      out.innerHTML = '<p class="pmsg">' + esc(UNCHECKED[data.reason] || '这次没查成。') + '</p>';
      return;
    }
    out.innerHTML = '';
  }

  // --- wiring -------------------------------------------------------------

  function search(pick) {
    var input = pick.querySelector('.pq');
    var btn = pick.querySelector('.pgo');
    var out = pick.querySelector('.pout');
    var q = (input.value || '').trim();
    if (!q) { out.innerHTML = '<p class="pmsg">先填 App 的名字。</p>'; return; }
    btn.disabled = true;
    out.innerHTML = '<p class="pmsg">找…</p>';
    fetch('/api/candidates?q=' + encodeURIComponent(q), { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(String(r.status))); })
      .then(function (data) { render(out, data); })
      .catch(function () {
        out.innerHTML = '<p class="perr">没查成，网络或者服务的问题。自己填一个 scheme 直接试跳也行。</p>';
      })
      .then(function () { btn.disabled = false; });
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var el = t && t.closest ? t : null;
    if (!el) return;

    var go = el.closest('.pgo');
    if (go) { e.preventDefault(); search(go.closest('.pick')); return; }

    // Both jump paths below assign location.href in this same synchronous
    // dispatch. Nothing between here and the assignment may await.
    var ctry = el.closest('.ctry');
    if (ctry) {
      var form = ctry.closest('form[data-ns]');
      if (form) saveDraft(form);
      if (!jump(ctry.getAttribute('data-scheme'))) showJumpError(ctry, '这条不像能跳的 scheme。');
      return;
    }

    var probe = el.closest('button[data-try]');
    if (probe) {
      var pform = probe.closest('form[data-ns]');
      var box = pform ? pform.querySelector('[name=scheme]') : null;
      var v = box ? (box.value || '').trim() : '';
      if (pform) saveDraft(pform);
      if (!jump(v)) {
        showJumpError(probe, v ? '这个不像能跳的 scheme，形状要是 xxx:// 。' : '先填一个 scheme。');
      }
      return;
    }

    var use = el.closest('.cuse');
    if (use) {
      var uform = use.closest('form[data-ns]');
      if (!uform) return;
      var f = fieldsOf(uform);
      if (f.scheme) f.scheme.value = use.getAttribute('data-scheme') || '';
      var name = use.getAttribute('data-label') || '';
      if (f.label && !f.label.value && name) f.label.value = name;
      if (f.scheme) { f.scheme.focus(); f.scheme.setSelectionRange(f.scheme.value.length, f.scheme.value.length); }
      return;
    }
  });

  function showJumpError(near, text) {
    var host = near.closest('.field') || near.parentNode;
    var p = host.querySelector('.perr');
    if (!p) {
      p = document.createElement('p');
      p.className = 'perr';
      host.appendChild(p);
    }
    p.textContent = text;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (!t || !t.closest || !t.classList.contains('pq')) return;
    // Enter in the search box must not submit the configuration form it sits in.
    e.preventDefault();
    search(t.closest('.pick'));
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form && form.getAttribute && form.getAttribute('data-ns')) clearDraft(form);
  });

  restoreDrafts();
})();
`
