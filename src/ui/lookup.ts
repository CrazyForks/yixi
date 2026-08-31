// /lookup — the whole URL-scheme question on one page: find the strings that
// might be an app's scheme, then try them on the phone in your hand.
//
// It used to be two pages. /probe answered "does this scheme work", nothing
// answered "what should I type into /probe", and the honest answer is that this
// server does not know. The lists circulating online disagree with each other,
// apps drop schemes without telling anyone, and a wrong scheme produces no
// error at all — the user breathes for ten seconds, taps 「继续」, and stops in
// Safari. This project has twice had an unverified string read as an answer, so
// this page is built the other way round: every line arrives labelled with where
// it came from and how little that is worth, and the only thing that settles the
// question is the phone in the reader's hand.
//
// Which is exactly why the split was wrong. Finding a candidate and trying it
// are two steps of one job, and putting them on separate tabs meant the reader
// had to carry a string between them — while the nav paid for it with a sixth
// tab that a 375px phone could not show. /probe now redirects here, and the two
// regions below are the two steps, in order.
//
// Hence the button order inside a candidate: 「试跳」 is the wide, dark, obvious
// one and carries a ①; 「存进…」 is a quiet line underneath carrying a ②.
// Testing first is not advice here, it is the visual hierarchy — the same reason
// the breathing page shows 算了 first and louder than 继续.
//
// The jump uses `location.href` inside a click handler, which is the same
// synchronous gesture-stack navigation the breathing page's 「继续」 performs.
// `<a href>`, a `setTimeout`, or anything after an `await` is a different
// mechanism in Safari, and a scheme certified by the wrong one would still fail
// where it matters. One `jump()` now serves the candidates, the configured apps
// and the hand-typed box, so the three cannot drift apart.

import type { Env, User, UserApp } from '../types'
import { DEFAULT_GRACE_SECONDS, DEFAULT_WAIT_SECONDS } from '../types'
import { getUserApp, listUserApps, upsertUserApp } from '../db'
import { DEFAULT_THEME, escapeHtml, jsonScript, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { fold, hl, icon, seal } from './icons'
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
 * shared with the breathing page, because three copies of that particular list
 * had already drifted once.
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
  /**
   * The App Store did not give a usable answer. `why` is carried because the
   * three causes need different advice and one of them is not the operator's
   * fault at all: Apple appears to refuse Cloudflare's egress addresses, so
   * this path fails in production while working from a laptop. Collapsing them
   * into "timed out or was blocked" sent me chasing a timeout that never
   * happened.
   */
  | { state: 'unavailable'; why: 'refused'; status: number }
  | { state: 'unavailable'; why: 'timeout' }
  | { state: 'unavailable'; why: 'unreadable' }
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
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
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
    if (!res.ok) return { state: 'unavailable', why: 'refused', status: res.status }

    const body: unknown = await res.json()
    const results = (body as { results?: unknown }).results
    if (!Array.isArray(results)) return { state: 'unavailable', why: 'unreadable' }

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
    // Keyed off our own timer rather than the rejection's name: whether an
    // aborted fetch rejects with something called AbortError is the runtime's
    // business, and this only needs to know whether we were the one who gave
    // up. "We stopped waiting" and "the request never landed" point at
    // different things to check.
    return timedOut
      ? { state: 'unavailable', why: 'timeout' }
      : { state: 'unavailable', why: 'unreadable' }
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
        ? `<h2>「${escapeHtml(q)}」的候选 · ${hits.length} 个 App</h2>\n${legend()}\n` +
          hits.map((a) => tableCard(a, q, mine, jumps)).join('\n')
        : await missCard(q, mine, jumps, deps)
  }

  // The candidate region renders first so its schemes take the low indices in
  // the island; the probe region below appends to the same array. One island and
  // one jump(), whatever the button belongs to.
  const body = `${consoleHeader(user, 'lookup')}
<main>
  <h1>查 URL scheme</h1>
  <p class="lede">输入 App 的名字，这一页把两份公开清单里记着的字符串抄给你，省掉一个个手打。它<b>不知道哪个是对的</b>——下半页就是用来试的。</p>
  ${searchForm(q)}
  ${o.error ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''}
  ${await savedBanner(env, user, o)}
  ${disclaimer()}
  ${results === '' ? firstRun() : results}
  <hr class="sep">
  ${probeRegion(mine, jumps)}
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
  <button type="submit">${icon('lookup', { label: '查' })}</button>
</form>`
}

/**
 * The page's one non-negotiable claim, and it stays above the results because
 * the failure it describes is silent: a wrong scheme looks exactly like a right
 * one until the moment it matters.
 *
 * It used to be four paragraphs. What holds it together now is not the icon but
 * the ordinals on the two buttons in every row — the rule 「试跳 first, 存进 only
 * after your phone really jumped」 moved *into* the thing it governs, so the line
 * up here only has to state it, not teach it.
 */
function disclaimer(): string {
  return `<div class="strip">
  ${hl('caveat', '下面每条都<b>没验证过</b> · 先<b>试跳</b>，跳通了再存')}
  ${fold(
    '为什么不能直接存',
    `<p>清单会过期，App 也会悄悄把 scheme 关掉，而且<b>猜错不会报错</b>——你会呼吸十秒、点「继续」，
      然后停在 Safari 里哪也去不了。清单快照抄于 ${SNAPSHOT_DATE}，之后的变动这里不知道；表里共 ${APPS.length} 个 App。</p>`,
  )}
</div>`
}

/**
 * The three tiers, explained once per page instead of once per row.
 *
 * This is where most of the deleted words went. Every candidate used to carry
 * 「实测跳通过」/「清单收录 · 未验证」/「推导 · 很可能不对」 as a pill, three
 * different lengths wrapping at three different places, and the difference
 * between the tiers had to be read rather than seen. Shape carries it now:
 * a pressed seal, a recorded seal, a seal drawn in dashes.
 */
function legend(): string {
  const row = (tier: 'verified' | 'listed' | 'derived', short: string, gloss: string): string =>
    `<li class="t-${tier}"><span class="sigbig">${seal(tier, { cls: 'lg', label: short })}</span>
    <b>${short}</b><span class="tm">${gloss}</span></li>`
  return `<ul class="tiers">
  ${row('verified', '跳通过', '在真手机上跳进去过，日期和机型就在那一条上')}
  ${row('listed', '未验证', '清单里抄来的，可能已经失效')}
  ${row('derived', '大概不对', '照 bundle id 硬推的，跳不通是常态')}
</ul>`
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
  <a class="banner-go" href="#app-${escapeHtml(row.app)}">去下面实测这条</a></p>`
}

// --- candidates ------------------------------------------------------------

function tableCard(a: AppEntry, q: string, mine: UserApp[], jumps: Jumps): string {
  return `<section class="card">
  <div class="card-head">
    <span class="name">${escapeHtml(a.name)}</span>
    <span class="key">${escapeHtml(a.key)}</span>
    <span class="badge">${escapeHtml(a.category)}</span>
  </div>
  ${bundleFold(a.bundleId)}
  ${a.candidates.map((c) => candidateRow(c, a.name, a.key, q, mine, jumps)).join('\n')}
</section>`
}

/** One tap for the reader who wants to check the derivation; one line for everyone else. */
function bundleFold(bundleId: string | undefined): string {
  if (bundleId === undefined) return ''
  return fold('bundle id', `<p class="mono bid">${escapeHtml(bundleId)}</p>`)
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
    const detail =
      store.why === 'refused'
        ? `App Store 拒绝了这次查询（HTTP ${store.status}）。这多半不是你配错了——
           Apple 会挡掉数据中心出口的地址，而这个服务就跑在 Cloudflare 上，所以从这里查
           常常查不通，从自己电脑上查却正常。`
        : store.why === 'timeout'
          ? '等 App Store 回话超时了。过一会儿再试。'
          : 'App Store 回了一段读不懂的东西。过一会儿再试。'
    return `${preamble}
<p class="empty">${detail}<br>
这一页<b>不会替你编一个 scheme 出来</b>——往下翻到「实测」那一段，用手输框打一个候选来试，
或者去<a href="https://github.com/WengYuehTing/iOS-app-info" rel="noreferrer">这份清单</a>里找。</p>`
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
  ${bundleFold(app.bundleId)}
  ${rows}
</section>`
    })
    .join('\n')

  return `${preamble}
<div class="strip">
  ${hl('caveat', '下面全是<b>猜的</b> · App Store 从来不公布 scheme')}
  ${fold(
    'App Store 到底证明了什么',
    `<p>它只证明了这些 App 存在，以及 Apple 给它们的正式名字和 bundle id。
      <b>它没有告诉任何人 URL scheme 是什么</b>——scheme 不在 App Store 的数据里。
      下面每一条都是照 bundle id 的命名规律硬推出来的，<b>大概率不对</b>，跳不通是正常结果。</p>`,
  )}
</div>
${legend()}
${cards}`
}

const TIER: Record<Candidate['confidence'], { cls: string; short: string }> = {
  verified: { cls: 'verified', short: '跳通过' },
  listed: { cls: 'listed', short: '未验证' },
  derived: { cls: 'derived', short: '大概不对' },
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

  const marks: string[] = []
  // A verified seal with nothing behind it is just a louder 「未验证」. One phone
  // on one iOS version is real evidence and a limited one, so the reader gets
  // the date here and the circumstances just below, and can weigh it — a scheme
  // that worked once can be dropped in the app's next release.
  if (c.confidence === 'verified' && c.verifiedOn) {
    marks.push(`<span class="mk when">${icon('clock')}${escapeHtml(c.verifiedOn)}</span>`)
  }
  if (isCorroborated(c)) marks.push(`<span class="mk">${icon('agree')}两份清单一致</span>`)
  for (const s of c.sources) {
    marks.push(
      `<a class="mk" href="${escapeHtml(s.url)}" rel="noreferrer">${icon('source')}${escapeHtml(s.label)}</a>`,
    )
  }
  // Their own row, matched on the scheme rather than on the app key: this is
  // the only "the user picked this" signal the server has, and it deliberately
  // does not upgrade the tier — writing a string into a config proves nothing
  // about whether a phone answers to it.
  const saved = mine.find((m) => m.scheme.toLowerCase() === c.scheme.toLowerCase())
  if (saved !== undefined) {
    marks.push(
      `<a class="mk mine" href="/settings#app-${escapeHtml(saved.app)}">${icon('save')}已写进 ${escapeHtml(saved.app)}</a>`,
    )
  }

  const evidence =
    c.confidence === 'verified' && c.verifiedNote
      ? `<p class="evidence">${escapeHtml(c.verifiedNote)}</p>`
      : ''

  return `<form class="cand" method="post" action="/lookup">
  <div class="c2-row">
    <span class="sig ${tier.cls}">${seal(c.confidence)}${tier.short}</span>
    <code class="mono cand-scheme">${escapeHtml(c.scheme)}</code>
  </div>
  ${marks.length === 0 ? '' : `<div class="marks">${marks.join('\n    ')}</div>`}
  ${evidence}
  ${c.caveat === undefined ? '' : fold('备注', `<p>${escapeHtml(c.caveat)}</p>`)}
  <button class="try" type="button" data-i="${i}"><span class="ord">1</span>${icon('jump')}试跳「${escapeHtml(appName)}」</button>
  <input type="hidden" name="op" value="use">
  <input type="hidden" name="q" value="${escapeHtml(q)}">
  <input type="hidden" name="key" value="${escapeHtml(key)}">
  <input type="hidden" name="label" value="${escapeHtml(appName)}">
  <input type="hidden" name="scheme" value="${escapeHtml(c.scheme)}">
  <div class="acts">
    <button class="use2" type="submit"><span class="ord">2</span>${icon('save')}跳通了 · 存进 <span class="mono">${escapeHtml(key)}</span></button>
  </div>
</form>`
}

// --- the probe region ------------------------------------------------------

/**
 * The second half of the same job, and everything the standalone /probe page
 * could do: one big button per configured app, a box for a string that is not
 * saved anywhere yet, and the jump written the one way that counts.
 *
 * `id="app-<key>"` is load-bearing beyond scrolling: /probe#app-xhs redirects
 * here without a fragment of its own, so the browser re-applies the original
 * one and an old bookmark still lands on the right card.
 */
function probeRegion(apps: UserApp[], jumps: Jumps): string {
  return `<section class="probe">
  <h2>实测 · 跳得动才算数</h2>
  ${hl('jump', '在 <b>iPhone 的 Safari 里</b>点，电脑上点没有意义。这一页不记录任何东西，点多少次都不进你的回顾。')}
  ${fold(
    '怎么看结果',
    `<ul>
      <li>手机<b>跳到那个 App</b> 了 —— scheme 对，回上面点那条候选的「存进」，或者去<a href="/settings">设置</a>填。</li>
      <li>点了<b>没反应</b>，或弹出「Safari 打不开该网页」 —— scheme 不对，换一个候选再试。</li>
      <li>一个候选都试不通 —— 这个 App 大概已经把 scheme 关掉了，只能对它放弃拦截，或者接受「点完继续自己再点一次图标」。</li>
    </ul>`,
  )}
  <div class="manual">
    <label class="sr" for="manual">手打一个 scheme</label>
    <input id="manual" type="text" class="mono" placeholder="someapp://" inputmode="url"
      autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="200" enterkeyhint="go">
    <button id="manual-go" type="button">试试</button>
  </div>
  <p class="note" id="manual-err" hidden></p>
  <p class="note">手上已经有字符串就直接填这一栏，不用先写进配置。</p>
  <h3>你已配的 App</h3>
  ${apps.length === 0 ? probeEmpty() : apps.map((a) => appCard(a, jumps)).join('\n')}
</section>`
}

function probeEmpty(): string {
  return `<p class="empty">还没有配置任何 App，没什么可试的。<br>上面查一个，跳通了直接存；或者去<a href="/settings">设置</a>手动加。</p>`
}

function appCard(a: UserApp, jumps: Jumps): string {
  const i = jumps.schemes.push(a.scheme) - 1
  const key = escapeHtml(a.app)
  return `<section class="card${a.enabled ? '' : ' off'}" id="app-${key}">
  <div class="card-head">
    <span class="name">${escapeHtml(a.label)}</span>
    <span class="key">${key}</span>
    ${a.enabled ? '' : '<span class="badge">已停用</span>'}
  </div>
  <code class="mono scheme">${escapeHtml(a.scheme)}</code>
  <button class="try" type="button" data-i="${i}">${icon('jump')}试跳「${escapeHtml(a.label)}」</button>
  <div class="after">
    <a class="mk" href="/settings#app-${key}">${icon('settings')}改这条配置</a>
  </div>
</section>`
}

// --- assets ----------------------------------------------------------------

const LOOKUP_CSS = `
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.find{display:flex;gap:8px;align-items:stretch;margin:0 0 16px}
.find input{flex:1;min-width:0}
.find button{flex:0 0 auto;background:transparent;color:var(--fg);border:1px solid var(--rule);
  border-radius:10px;padding:0 20px;display:inline-flex;align-items:center;justify-content:center}
.find button:active{opacity:.72}
.find button .ic{width:18px;height:18px}

/* the two "read this before you trust the list" strips */
.strip{border:1px solid var(--rule);border-radius:7px;padding:10px 12px;margin:0 0 16px;
  font-size:12.5px;line-height:1.7;color:var(--dim)}
.strip b{color:var(--fg)}
details > ul{margin:8px 0 9px;padding-left:1.15em;font-size:12.5px;line-height:1.85;color:var(--dim)}
details > ul b{color:var(--fg)}
details > ul li{margin:3px 0}

/* the three tiers, said once */
.tiers{list-style:none;margin:0 0 18px;padding:0}
.tiers li{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--rule)}
.tiers li:first-child{border-top:0;padding-top:2px}
.sigbig{display:inline-flex;flex:none;color:var(--dim)}
.tiers b{flex:none;min-width:4.4em;font-size:13px;font-weight:600;color:var(--fg)}
.tiers .tm{font-size:11.5px;line-height:1.6;color:var(--faint)}
.t-verified .sigbig{color:var(--fg)}
.t-derived .sigbig{color:var(--danger)}
.t-derived b{color:var(--danger)}

/* one candidate */
.cand{border-top:1px solid var(--rule);padding:14px 0 2px;margin:0}
.cand:first-of-type{border-top:0;padding-top:4px}
.c2-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 8px}
.cand-scheme{word-break:break-all;font-size:13.5px;-webkit-user-select:all;user-select:all}
.sig{display:inline-flex;align-items:center;gap:5px;font-size:11px;letter-spacing:.06em;
  white-space:nowrap;color:var(--dim)}
.sig.verified{color:var(--fg)}
.sig.derived{color:var(--danger)}
.marks{display:flex;flex-wrap:wrap;gap:6px;margin:0}
.mk{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dim);
  text-decoration:none;border:1px solid var(--rule);border-radius:4px;padding:1.5px 9px;white-space:nowrap}
.mk.mine{border-style:dashed;color:var(--faint)}
.mk.when{font-variant-numeric:tabular-nums;letter-spacing:.04em}
.evidence{margin:7px 0 0;font-size:.78rem;color:var(--dim);line-height:1.6}
.bid{font-size:11.5px;color:var(--faint);margin:6px 0 0;-webkit-user-select:all;user-select:all}

/* ① try, ② save — the ordinals are the ordering rule, not decoration */
.try{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:8px;
  background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  border-radius:6px;padding:13px 16px;font-size:15px;font-weight:600;min-height:50px;margin-top:12px}
.try:active{opacity:.72}
.acts{display:flex;justify-content:center;margin:0}
.use2{display:inline-flex;align-items:center;gap:7px;color:var(--dim);font-size:13px;
  padding:12px 0 2px;min-height:44px}
.use2 .mono{font-size:12.5px}
.ord{display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:17px;height:17px;border-radius:3px;border:1px solid currentColor;
  font-family:var(--num);font-size:10.5px;font-weight:400;opacity:.72}
h2{margin:22px 0 12px}

/* the probe region */
.probe h3{margin:20px 0 12px;font-size:12px;font-weight:400;color:var(--faint);letter-spacing:.14em}
.probe .scheme{display:block;color:var(--dim);word-break:break-all;margin:0 0 4px}
.manual{display:flex;gap:8px;align-items:stretch;margin:12px 0 0}
.manual input{flex:1;min-width:0}
.manual button{flex:0 0 auto;background:transparent;color:var(--fg);border:1px solid var(--rule);
  border-radius:10px;padding:0 16px;font-size:15px;font-weight:600}
.manual button:active{opacity:.72}
.after{display:flex;justify-content:flex-end;margin-top:11px}
`

/**
 * The jump is the whole product surface for this page, and its shape is the
 * requirement rather than a style. `location.href` assigned synchronously inside
 * a click handler is the same gesture-stack navigation the breathing page's
 * 「继续」 performs; an `<a href>`, a `setTimeout`, or anything reached after an
 * `await` is a different mechanism in Safari, and would certify schemes that
 * then fail in the one place it counts.
 *
 * Every jumpable thing on the page — a candidate, a configured app, a string
 * typed into the box — goes through this one function. That used to be a promise
 * kept by a test comparing two pages byte for byte; now it is structural.
 *
 * BAD repeats the denylist even though the write path already refuses those
 * schemes: the box accepts anything the reader types, including a line pasted
 * from a forum, and a derived candidate is assembled from a string Apple
 * returned.
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

  var input = document.getElementById('manual');
  var err = document.getElementById('manual-err');
  function tryManual() {
    var v = (input.value || '').trim();
    if (jump(v)) { err.hidden = true; return; }
    err.textContent = v ? '这个不像一个能跳的 scheme，形状要是 xxx:// 。' : '先填一个 scheme。';
    err.hidden = false;
  }
  document.getElementById('manual-go').addEventListener('click', tryManual);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryManual(); });
})();
`
