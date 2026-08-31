// /lookup — type an app's name, get the strings that might be its URL scheme.
//
// /probe answers "does this scheme work"; nothing answered "what should I type
// into /probe", and the honest answer is that this server does not know. The
// lists circulating online disagree with each other, apps drop schemes without
// telling anyone, and a wrong scheme produces no error at all — the user
// breathes for ten seconds, taps 「继续」, and stops in Safari. This project has
// twice had an unverified string read as an answer, so this page is built the
// other way round: every line arrives labelled with where it came from and how
// little that is worth, and the only thing that settles the question is the
// phone in the reader's hand.
//
// Hence the button order. 「试一下」 is the wide, dark, obvious one; 「就用这个」
// is a quiet line of text underneath it. Testing first is not advice here, it is
// the visual hierarchy — the same reason the breathing page shows 算了 first and
// louder than 继续.
//
// The jump uses `location.href` inside a click handler, copied from probe.ts
// deliberately and not merely coincidentally: `<a href>` and a synchronous
// handler are different mechanisms in Safari, and a scheme certified by the
// wrong one would still fail where it matters.

import type { Env, User, UserApp } from '../types'
import { DEFAULT_GRACE_SECONDS, DEFAULT_WAIT_SECONDS } from '../types'
import { getUserApp, listUserApps, upsertUserApp } from '../db'
import { DEFAULT_THEME, escapeHtml, jsonScript, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { forbiddenSchemePattern, safeScheme } from '../scheme'
import {
  APPS,
  SNAPSHOT_DATE,
  deriveFromBundleId,
  findApps,
  isCorroborated,
  suggestKey,
  type AppEntry,
  type Candidate,
} from '../schemes'

/**
 * The App Store call is injectable for one reason: the test suite must not
 * depend on the network. A test that silently starts hitting itunes.apple.com
 * is a test that goes red on a train, and the failure mode it is guarding —
 * "iTunes is down and the page still renders" — cannot be provoked at all
 * without a stand-in.
 */
export interface LookupDeps {
  fetchImpl?: typeof fetch
  /** How long to wait on the App Store before giving up and saying so. */
  timeoutMs?: number
}

export async function handleLookup(
  request: Request,
  env: Env,
  user: User,
  deps: LookupDeps = {},
): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url)
    return await render(env, user, deps, {
      q: url.searchParams.get('q') ?? '',
      saved: url.searchParams.get('saved'),
      mode: url.searchParams.get('mode'),
    })
  }
  if (request.method === 'POST') return await handleUse(request, env, user, deps)
  return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST' } })
}

// --- write path ------------------------------------------------------------

/**
 * The app key charset and the two length caps are /settings' rules restated.
 * The scheme itself is not restated — `safeScheme` is the one authority on that,
 * shared with /probe and the breathing page, because three copies of that
 * particular list had already drifted once.
 */
const APP_KEY = /^[a-z0-9_-]{1,32}$/
const MAX_LABEL = 40
const MAX_SCHEME = 200

/**
 * Writes one candidate into the caller's own configuration.
 *
 * Two things it will not do. It never overwrites the wait and grace seconds of
 * a row that already exists — somebody who set a 20-second wait did that on
 * purpose, and this page is about the scheme. And it refuses outright when the
 * app key is taken by a row with a different display name: the whole failure
 * class this feature exists to prevent is a wrong scheme landing somewhere it
 * looks authoritative, and silently repointing an unrelated app is exactly
 * that. Refusing costs one trip to /settings; guessing costs a broken app the
 * user will not find out about until they are standing in the dark.
 */
async function handleUse(request: Request, env: Env, user: User, deps: LookupDeps): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return await render(env, user, deps, { q: '', error: '表单没读出来，重试一次。', status: 400 })
  }

  const q = field(form, 'q')
  const fail = (error: string): Promise<Response> =>
    render(env, user, deps, { q, error, status: 400 })

  if (field(form, 'op') !== 'use') return await fail('不认识这个操作。')

  const key = field(form, 'key')
  if (!APP_KEY.test(key)) return await fail('App 键只能用小写字母、数字、- 和 _，最长 32 位。')

  const label = field(form, 'label')
  if (label.length === 0 || label.length > MAX_LABEL) return await fail('显示名不对。')

  const raw = field(form, 'scheme')
  if (raw.length === 0 || raw.length > MAX_SCHEME) return await fail('URL scheme 不对。')
  const scheme = safeScheme(raw)
  if (scheme === '') return await fail('这个 scheme 不能用。它要长成 xxx:// 的样子。')

  const existing = await getUserApp(env.DB, user.id, key)
  if (existing !== null && existing.label !== label) {
    return await fail(
      `你已经有一条 App 键叫 ${key} 的配置，显示名是「${existing.label}」。` +
        `这里不动它——去设置页手动加一条，App 键自己另起一个。`,
    )
  }

  const row: UserApp = {
    user_id: user.id,
    app: key,
    label: existing?.label ?? label,
    scheme,
    wait_seconds: existing?.wait_seconds ?? DEFAULT_WAIT_SECONDS,
    grace_seconds: existing?.grace_seconds ?? DEFAULT_GRACE_SECONDS,
    enabled: existing?.enabled ?? 1,
  }
  await upsertUserApp(env.DB, row)

  const mode = existing === null ? 'new' : 'update'
  return seeOther(`/lookup?q=${encodeURIComponent(q)}&saved=${encodeURIComponent(key)}&mode=${mode}`)
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } })
}

function field(form: FormData, key: string): string {
  const v = form.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

// --- App Store fallback ----------------------------------------------------

interface StoreApp {
  name: string
  bundleId: string
}

type StoreResult =
  | { state: 'ok'; apps: StoreApp[] }
  /** The App Store answered and has no such app. */
  | { state: 'empty' }
  /** Timed out, refused, or returned something unreadable. */
  | { state: 'unavailable' }
  /** Query too short or too long to be worth an outbound request. */
  | { state: 'skipped' }

const DEFAULT_TIMEOUT_MS = 2500

/**
 * Confirms an app exists and gets its real name and bundle id, so the guesses
 * below at least hang off something Apple published rather than off a name
 * somebody typed.
 *
 * Every failure collapses to `unavailable`, which the page reports as "could
 * not check" — never as "no such app", and never as an excuse to invent a
 * scheme. This is a server-side fetch; the pages' zero-external-request rule is
 * about the browser, and the CSP still forbids the page itself from reaching
 * anywhere.
 */
async function searchAppStore(term: string, deps: LookupDeps): Promise<StoreResult> {
  if (term.length < 2 || term.length > 40) return { state: 'skipped' }

  const f = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const url =
      'https://itunes.apple.com/search?term=' +
      encodeURIComponent(term) +
      '&country=cn&entity=software&limit=5'
    const res = await f(url, {
      signal: controller.signal,
      // Repeat lookups of the same name are common and the answer changes
      // roughly never; one cached edge copy spares both sides the round trip.
      cf: { cacheTtl: 3600, cacheEverything: true },
    })
    if (!res.ok) return { state: 'unavailable' }

    const body: unknown = await res.json()
    const results = (body as { results?: unknown }).results
    if (!Array.isArray(results)) return { state: 'unavailable' }

    const apps: StoreApp[] = []
    for (const r of results) {
      if (typeof r !== 'object' || r === null) continue
      const rec = r as Record<string, unknown>
      const name = typeof rec.trackName === 'string' ? rec.trackName : ''
      const bundleId = typeof rec.bundleId === 'string' ? rec.bundleId : ''
      if (name === '' || bundleId === '') continue
      apps.push({ name, bundleId })
      if (apps.length >= 5) break
    }
    return apps.length === 0 ? { state: 'empty' } : { state: 'ok', apps }
  } catch {
    return { state: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

// --- render ----------------------------------------------------------------

interface RenderOptions {
  q: string
  saved?: string | null
  mode?: string | null
  error?: string
  status?: number
}

/** Accumulates the schemes the inline script may jump to, in render order. */
interface Jumps {
  schemes: string[]
}

async function render(env: Env, user: User, deps: LookupDeps, o: RenderOptions): Promise<Response> {
  const q = o.q.trim().slice(0, 60)
  const mine = await listUserApps(env.DB, user.id)
  const jumps: Jumps = { schemes: [] }

  let results = ''
  if (q !== '') {
    const hits = findApps(q)
    results =
      hits.length > 0
        ? `<h2>「${escapeHtml(q)}」的候选 · ${hits.length} 个 App</h2>\n` +
          hits.map((a) => tableCard(a, q, mine, jumps)).join('\n')
        : await missCard(q, mine, jumps, deps)
  }

  const body = `${consoleHeader(user, 'lookup')}
<main>
  <h1>查 URL scheme</h1>
  <p class="lede">输入 App 的名字，这一页把两份公开清单里记着的字符串抄给你，省掉一个个手打。它<b>不知道哪个是对的</b>。</p>
  ${searchForm(q)}
  ${o.error ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''}
  ${await savedBanner(env, user, o)}
  ${disclaimer()}
  ${results || firstRun()}
  <hr class="sep">
  <p class="note">一个候选都试不通的时候，这个 App 大概已经把 scheme 关掉了——只能对它放弃拦截，或者接受「点完继续自己再点一次图标」。
  手上已经有字符串想直接试，去<a href="/probe">实测</a>页最下面那个输入框。</p>
</main>
${jsonScript('lookup-data', jumps.schemes)}`

  return page({
    title: '查 scheme · 一息',
    theme: DEFAULT_THEME,
    css: CONSOLE_CSS + LOOKUP_CSS,
    body,
    script: SCRIPT,
    status: o.status ?? 200,
  })
}

function searchForm(q: string): string {
  return `<form class="find" method="get" action="/lookup">
  <label class="sr" for="q">App 名字</label>
  <input id="q" type="text" name="q" value="${escapeHtml(q)}" placeholder="小红书 / 起点 / bilibili"
    inputmode="search" autocapitalize="none" autocorrect="off" spellcheck="false"
    maxlength="60" enterkeyhint="search">
  <button type="submit">查</button>
</form>`
}

/**
 * The page's one non-negotiable paragraph. It is above the results rather than
 * below them because the failure it describes is silent: a wrong scheme looks
 * exactly like a right one until the moment it matters.
 */
function disclaimer(): string {
  return `<div class="warnbox">
  <b>这一页只是抄书</b>
  <p class="flat">下面每一条都<b>没有被验证过</b>。清单会过期，App 也会悄悄把 scheme 关掉，而且<b>猜错不会报错</b>——
  你会呼吸十秒、点「继续」，然后停在 Safari 里哪也去不了。所以顺序是：先点「试一下」，
  手机<b>真的跳进那个 App</b> 了，再点「就用这个」。</p>
  <p class="flat meta">清单快照抄于 ${SNAPSHOT_DATE}，之后的变动这里不知道。表里共 ${APPS.length} 个 App。</p>
</div>`
}

function firstRun(): string {
  return `<p class="empty">上面填一个 App 名字。<br>中文、英文、拼音、缩写都行——「小红书」「xhs」「b站」都能查到。</p>`
}

async function savedBanner(env: Env, user: User, o: RenderOptions): Promise<string> {
  const key = o.saved
  if (key === null || key === undefined || !APP_KEY.test(key)) return ''
  const row = await getUserApp(env.DB, user.id, key)
  if (row === null) return ''
  const tail =
    o.mode === 'update'
      ? '显示名、等待、免打扰都没动。'
      : `等待 ${row.wait_seconds} 秒、免打扰 ${row.grace_seconds} 秒，都是默认值。`
  return `<p class="banner good">已把 <span class="mono">${escapeHtml(row.app)}</span> 的 scheme 写成
  <span class="mono">${escapeHtml(row.scheme)}</span>。${tail}
  <a class="banner-go" href="/probe#app-${escapeHtml(row.app)}">去实测这条</a></p>`
}

// --- cards -----------------------------------------------------------------

function tableCard(a: AppEntry, q: string, mine: UserApp[], jumps: Jumps): string {
  const head = `<div class="card-head">
    <span class="name">${escapeHtml(a.name)}</span>
    <span class="key">${escapeHtml(a.key)}</span>
    <span class="badge">${escapeHtml(a.category)}</span>
  </div>`
  const bundle =
    a.bundleId === undefined
      ? ''
      : `<p class="note flat">bundle id <span class="mono">${escapeHtml(a.bundleId)}</span></p>`

  return `<section class="card">
  ${head}
  ${bundle}
  ${a.candidates.map((c) => candidateRow(c, a.name, a.key, q, mine, jumps)).join('\n')}
</section>`
}

/**
 * What the page shows when the table has never heard of the name. The App Store
 * is asked only to establish that the app exists and what Apple calls it; the
 * schemes underneath are pattern guesses off the bundle id and are labelled as
 * such in every place a reader might look.
 */
async function missCard(q: string, mine: UserApp[], jumps: Jumps, deps: LookupDeps): Promise<string> {
  const store = await searchAppStore(q, deps)

  const preamble = `<h2>表里没有「${escapeHtml(q)}」</h2>`

  if (store.state === 'skipped') {
    return `${preamble}
<p class="empty">名字太短或者太长，没法去 App Store 核对。换个写法再试。</p>`
  }
  if (store.state === 'unavailable') {
    return `${preamble}
<p class="empty">去 App Store 核对这一步没走通（超时或者被挡了）。<br>
这一页<b>不会替你编一个 scheme 出来</b>——过一会儿再试，或者直接去<a href="/probe">实测</a>页手打一个来试。</p>`
  }
  if (store.state === 'empty') {
    return `${preamble}
<p class="empty">App Store 里也搜不到叫这个名字的 App。<br>换个写法（全称、英文名）再试一次。</p>`
  }

  const cards = store.apps
    .map((app) => {
      const derived = deriveFromBundleId(app.bundleId)
      const key = suggestKey(app.bundleId, 'app')
      const rows =
        derived.length > 0
          ? derived.map((c) => candidateRow(c, app.name, key, q, mine, jumps)).join('\n')
          : `<p class="note flat">这个 bundle id 推不出任何形状合法的 scheme。没有候选可给。</p>`
      return `<section class="card">
  <div class="card-head">
    <span class="name">${escapeHtml(app.name)}</span>
    <span class="key">${escapeHtml(key)}</span>
    <span class="badge">App Store</span>
  </div>
  <p class="note flat">bundle id <span class="mono">${escapeHtml(app.bundleId)}</span></p>
  ${rows}
</section>`
    })
    .join('\n')

  return `${preamble}
<div class="warnbox">
  <b>下面全是猜的</b>
  <p class="flat">App Store 只证明了这些 App 存在，以及 Apple 给它们的正式名字和 bundle id。
  <b>它没有告诉任何人 URL scheme 是什么</b>——scheme 不在 App Store 的数据里。
  下面每一条都是照 bundle id 的命名规律硬推出来的，<b>大概率不对</b>，跳不通是正常结果。</p>
</div>
${cards}`
}

const TIER: Record<Candidate['confidence'], { cls: string; text: string }> = {
  verified: { cls: 'verified', text: '实测跳通过' },
  listed: { cls: 'listed', text: '清单收录 · 未验证' },
  derived: { cls: 'derived', text: '推导 · 很可能不对' },
}

function candidateRow(
  c: Candidate,
  appName: string,
  key: string,
  q: string,
  mine: UserApp[],
  jumps: Jumps,
): string {
  const i = jumps.schemes.push(c.scheme) - 1
  const tier = TIER[c.confidence]
  const evidence =
    c.confidence === 'verified' && c.verifiedNote
      ? `<p class="evidence">${escapeHtml(c.verifiedNote)}</p>`
      : ''

  const tags = [`<span class="tag ${tier.cls}">${tier.text}</span>`]
  // A verified badge with nothing behind it is just a louder 「清单收录」. One
  // phone on one iOS version is real evidence and a limited one, so the reader
  // gets the date and the circumstances and can weigh it — a scheme that worked
  // once can be dropped in the app's next release.
  if (c.confidence === 'verified' && c.verifiedOn) {
    tags.push(`<span class="tag when">${escapeHtml(c.verifiedOn)}</span>`)
  }
  if (isCorroborated(c)) tags.push('<span class="tag">两份清单一致</span>')
  for (const s of c.sources) {
    tags.push(`<a class="src" href="${escapeHtml(s.url)}" rel="noreferrer">${escapeHtml(s.label)}</a>`)
  }
  // Their own row, matched on the scheme rather than on the app key: this is
  // the only "the user picked this" signal the server has, and it deliberately
  // does not upgrade the tier — writing a string into a config proves nothing
  // about whether a phone answers to it.
  const saved = mine.find((m) => m.scheme.toLowerCase() === c.scheme.toLowerCase())
  if (saved !== undefined) {
    tags.push(
      `<a class="tag mine" href="/settings#app-${escapeHtml(saved.app)}">你已写进 ${escapeHtml(saved.app)}</a>`,
    )
  }

  return `<form class="cand" method="post" action="/lookup">
  <code class="mono cand-scheme">${escapeHtml(c.scheme)}</code>
  <div class="tags">${tags.join('\n    ')}</div>
  ${evidence}
  ${c.caveat === undefined ? '' : `<p class="caveat">${escapeHtml(c.caveat)}</p>`}
  <button class="try" type="button" data-i="${i}">试着跳到「${escapeHtml(appName)}」</button>
  <input type="hidden" name="op" value="use">
  <input type="hidden" name="q" value="${escapeHtml(q)}">
  <input type="hidden" name="key" value="${escapeHtml(key)}">
  <input type="hidden" name="label" value="${escapeHtml(appName)}">
  <input type="hidden" name="scheme" value="${escapeHtml(c.scheme)}">
  <div class="actions">
    <button class="linky use" type="submit">跳通了 · 就用这个</button>
    <span class="note flat">写进 <span class="mono">${escapeHtml(key)}</span> 这条配置</span>
  </div>
</form>`
}

// --- assets ----------------------------------------------------------------

const LOOKUP_CSS = `
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.find{display:flex;gap:8px;align-items:stretch;margin:0 0 18px}
.find input{flex:1;min-width:0}
.find button{flex:0 0 auto;background:transparent;color:var(--fg);border:1px solid var(--rule);
  border-radius:10px;padding:0 20px;font-size:15px;font-weight:600}
.find button:active{opacity:.72}
.warnbox{border:1px solid var(--rule);border-radius:14px;padding:14px;margin:0 0 18px;
  font-size:13px;line-height:1.75;color:var(--dim)}
.warnbox b{color:var(--fg)}
.warnbox p{margin:8px 0 0}
.warnbox .meta{font-size:11.5px;color:var(--faint);margin-top:10px}
.cand{border-top:1px solid var(--rule);padding:14px 0 2px;margin:0}
.cand:first-of-type{border-top:0;padding-top:4px}
.cand-scheme{display:block;word-break:break-all;font-size:14px;margin:0 0 9px;
  -webkit-user-select:all;user-select:all}
.tags{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:0 0 8px;font-size:11px;line-height:1.9}
.tag{border:1px solid var(--rule);border-radius:99px;padding:1px 9px;color:var(--dim);
  white-space:nowrap;letter-spacing:.06em;text-decoration:none}
.tag.derived{border-color:var(--danger);color:var(--danger)}
.tag.verified{background:var(--stop-bg);color:var(--stop-fg);border-color:var(--stop-border)}
.tag.mine{border-style:dashed}
.src{color:var(--faint);font-size:11px;text-decoration:underline;text-underline-offset:3px}
.evidence{margin:5px 0 0;font-size:.78rem;color:var(--dim);line-height:1.6}
.tag.when{font-variant-numeric:tabular-nums;letter-spacing:.04em}
.caveat{font-size:12px;line-height:1.75;color:var(--dim);margin:0 0 10px}
.try{width:100%;background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  border-radius:12px;padding:14px 18px;font-size:15px;font-weight:600;min-height:52px}
.try:active{opacity:.72}
.cand .actions{gap:10px;justify-content:space-between}
.cand .actions .note{text-align:right}
h2{margin:22px 0 12px}
`

/**
 * Byte-for-byte the jump from probe.ts, and that is the requirement rather than
 * a coincidence. `location.href` assigned synchronously inside a click handler
 * is the same gesture-stack navigation the breathing page's 「继续」 performs;
 * an `<a href>`, a `setTimeout`, or anything reached after an `await` is a
 * different mechanism in Safari, and would certify schemes that then fail in
 * the one place it counts.
 *
 * BAD repeats the denylist even though the write path already refuses those
 * schemes: nothing here came out of the database, and a derived candidate is
 * assembled from a string Apple returned.
 */
const SCRIPT = `
(function () {
  var BAD = /${forbiddenSchemePattern()}/i;
  var OK = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
  var el = document.getElementById('lookup-data');
  var schemes = el ? JSON.parse(el.textContent || '[]') : [];

  function jump(scheme) {
    if (!scheme || !OK.test(scheme) || BAD.test(scheme)) return false;
    location.href = scheme;
    return true;
  }

  var buttons = document.querySelectorAll('button[data-i]');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function (e) {
      jump(schemes[Number(e.currentTarget.getAttribute('data-i'))]);
    });
  }
})();
`
