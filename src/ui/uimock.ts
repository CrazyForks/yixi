/**
 * /mock-ui — a static before/after sheet for the "too many words" complaint.
 *
 * This is a mockup, not a refactor. Nothing here is wired to anything: no
 * session, no database, no form target, no user data. The live pages
 * (/lookup, /setup, /settings, the console header) are untouched — the point of
 * this page is to let the owner hold the phone and decide whether the icon
 * language is worth adopting before a single real page changes.
 *
 * Two directions, switchable:
 *   ?v=1 「线」 hairline line art — 1px geometry, no fill, same stroke weight as
 *              the console's existing hairlines. Reads as an instrument panel.
 *   ?v=2 「印」 ink and seals — status marks become 印章, strokes thicken into
 *              something closer to a brush, echoing the breathing page's wash.
 *
 * Three rules this page holds itself to, because they are the reason the
 * complaint is not simply "delete words":
 *
 *  1. Every icon is inline SVG. Zero external requests is a hard constraint of
 *     this product (layout.ts, enforced by CSP) and a mockup that cheats on it
 *     is measuring the wrong thing.
 *  2. No emoji. They render differently on every device and they are the wrong
 *     register for this product entirely.
 *  3. An icon has to carry information. Adding a picture next to a paragraph
 *     that stays intact is more clutter, not less — so every "after" pane below
 *     also shows what happened to the words: compressed to two or three
 *     characters, folded into <details>, or stated once in a legend instead of
 *     repeated per row.
 *
 * What does NOT get compressed away, only folded: the fail-open condition (get
 * it backwards and the tool locks you out of your own phone), "these are
 * candidates, only a real jump counts", and "a grace window that is too short
 * intercepts you the moment you land". Each keeps a visible one-line form with
 * the reasoning one tap away.
 *
 * No JavaScript at all — <details> is native, and a mockup that needs a runtime
 * is a mockup that can lie about the real page.
 */

import { CONSOLE_CSS } from './console'
import { DEFAULT_THEME, escapeHtml, page } from './layout'
import { APPS, SNAPSHOT_DATE } from '../schemes'

export type MockVariant = 'line' | 'ink'

/** `?v=1` -> 线, `?v=2` -> 印. Unknown values fall back to 线. */
function variantFromParam(v: string | null): MockVariant {
  return v === '2' || v === 'ink' ? 'ink' : 'line'
}

const VARIANT_TITLE: Record<MockVariant, string> = { line: '线', ink: '印' }

const VARIANT_LEDE: Record<MockVariant, string> = {
  line: '全部 1px 线稿，几何、不填色，跟控制台现有的发丝线同一个笔法。冷、准、不抢戏。',
  ink: '状态标记做成印章，笔画加粗一档带点手迹感，呼应呼吸页那团墨。暖、有重量、更像纸上的东西。',
}

/**
 * The switcher links have to work wherever the route is actually mounted, but
 * a pathname reflected into markup is still input. Anything that is not a plain
 * path collapses to the intended route.
 */
function selfPath(url: URL): string {
  return /^\/[A-Za-z0-9_/-]{0,63}$/.test(url.pathname) ? url.pathname : '/mock-ui'
}

export function renderUiMock(url: URL): Response {
  const v = variantFromParam(url.searchParams.get('v'))
  const here = selfPath(url)
  // Printed inside the "before" pane's paste block, same as /setup does, so the
  // comparison is against a realistic line length rather than a placeholder.
  const origin = escapeHtml(url.origin)

  const body = `<main class="mock">
${topBar(here, v)}
<h1>图标化改版 · 效果图</h1>
<p class="lede">「文字好多」这条反馈的答复。每一块先给<b>现在</b>的样子，紧跟<b>改后</b>的样子。
两版方向可以在上面切换，<b>线上页面一个字都没动</b>。</p>
<p class="vnote">${escapeHtml(VARIANT_TITLE[v])} · ${VARIANT_LEDE[v]}</p>

${section(
  '1',
  '候选页的一条候选',
  '现在一条候选要读四段才知道该点哪里：文字 pill、来源、备注、两个按钮加一句小字。',
  candBefore(),
  candAfter(v),
)}

${section(
  '2',
  '配置说明页的一个步骤',
  '现在每步是标题加两三段解释加代码块。步骤本身是「照抄」，解释里真正重要的只有一句。',
  setupBefore(origin),
  setupAfter(origin),
)}

${section(
  '3',
  '三档置信度',
  '同一句解释现在在每一行里重复。改后只在这里说一次，行里只留图标加两三个字。',
  tiersBefore(),
  tiersAfter(v),
)}

${section(
  '4',
  '顶部导航',
  '六个纯文字 tab，375px 宽的手机上要横向滚动才能看见后面两个。',
  navBefore(),
  navAfter(v),
)}

${section(
  '5',
  '设置页的免打扰秒数',
  '不在你列的四块里，但那段说明是「不能删只能压」的第三段，顺手一起改了。',
  graceBefore(),
  graceAfter(v),
)}

${divider(v)}
${tradeoffs(v)}
</main>`

  return page({
    title: '图标化效果图 · 一息',
    theme: DEFAULT_THEME,
    css: CONSOLE_CSS + LEGACY_CSS + MOCK_CSS,
    bodyAttrs: `class="v-${v}"`,
    body,
  })
}

// --- page chrome -----------------------------------------------------------

function topBar(here: string, current: MockVariant): string {
  const link = (v: MockVariant): string => {
    const on = v === current
    return `<a href="${here}?v=${v === 'line' ? '1' : '2'}"${on ? ' aria-current="true"' : ''}>${
      VARIANT_TITLE[v]
    }</a>`
  }
  return `<nav class="uibar" aria-label="图标方向">
  <span class="brand">一息</span>
  <span class="ub-label">图标方向</span>${link('line')}${link('ink')}
</nav>`
}

function section(n: string, title: string, lede: string, before: string, after: string): string {
  return `<section class="cmp">
  <h2><span class="n">${n}</span>${title}</h2>
  <p class="clede">${lede}</p>
  <div class="panes">
    ${pane('before', '现在', before)}
    ${pane('after', '改后', after)}
  </div>
</section>`
}

function pane(kind: 'before' | 'after', label: string, inner: string): string {
  return `<div class="pane ${kind}">
    <p class="plabel">${label}</p>
    ${inner}
  </div>`
}

/** 线 gets a hairline rule; 印 gets one tapered brush stroke. */
function divider(v: MockVariant): string {
  if (v === 'line') return '<hr class="sep">'
  return `<svg class="brush" viewBox="0 0 240 8" aria-hidden="true" focusable="false" preserveAspectRatio="none">
  <path d="M2 4.4c38-2.2 94-3 138-2.1 36 .7 62 1.5 98 2.5-36 1.7-64 2.1-98 1.7-44-.5-100-.3-138-2.1z"/>
</svg>`
}

// --- icons -----------------------------------------------------------------

type IconName =
  | 'verified'
  | 'listed'
  | 'derived'
  | 'caveat'
  | 'jump'
  | 'save'
  | 'agree'
  | 'source'
  | 'lockout'
  | 'clock'
  | 'loop'
  | 'chev'
  | 'fetch'
  | 'branch'
  | 'review'
  | 'settings'
  | 'lookup'
  | 'probe'
  | 'setup'
  | 'account'
  | 'admin'

/**
 * One 24x24 grid, stroke-only, `currentColor`, no fill — so an icon inherits
 * the colour of the text it sits beside and needs no per-theme variant. Weight
 * is a CSS matter (`.ic` vs `.v-ink .ic`), which is why both directions can
 * share this geometry instead of duplicating twenty-one shapes.
 */
const ICONS: Record<IconName, string> = {
  // A closed ring with a tick: the only tier a phone can grant.
  verified: '<circle cx="12" cy="12" r="8.4"/><path d="M8.2 12.5l2.7 2.6 5-5.6"/>',
  // A page with lines: copied out of somebody's list.
  listed:
    '<path d="M6.8 4.6h6.6l3.8 3.8v11H6.8z"/><path d="M13.4 4.6v3.8h3.8"/><path d="M9.4 11.8h5.2M9.4 14.6h5.2M9.4 17.2h3"/>',
  // A broken ring, struck through: a guess, and the dashes say so.
  derived: '<circle cx="12" cy="12" r="8.4" stroke-dasharray="2.4 3.1"/><path d="M8.6 15.4l6.8-6.8"/>',
  caveat: '<path d="M12 4.9l8.1 14.2H3.9z"/><path d="M12 9.9v4.4"/><path d="M12 16.7h.01"/>',
  // Arrow leaving a frame: the jump out to another app.
  jump:
    '<path d="M18.4 13.6v4.4a1.4 1.4 0 0 1-1.4 1.4H6.8a1.4 1.4 0 0 1-1.4-1.4V7.8a1.4 1.4 0 0 1 1.4-1.4h4.4"/><path d="M14.6 4.8h4.6v4.6"/><path d="M11.4 12.6l7.6-7.6"/>',
  // Arrow into a tray: write it into the configuration.
  save: '<path d="M5.6 15.2v2.8a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4v-2.8"/><path d="M12 4.8v9"/><path d="M8.4 10.4L12 14l3.6-3.6"/>',
  // List lines plus a tick clear of them: both collections say the same thing.
  agree:
    '<path d="M4.6 7.6h10.4M4.6 12h6.4M4.6 16.4h4"/><path d="M12.6 16.2l2.2 2.2 4.6-5.6"/>',
  source:
    '<path d="M10.2 13.8a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 5l-1 1"/><path d="M13.8 10.2a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5-5l1-1"/>',
  // A closed padlock: the failure mode is being locked out of your own phone.
  lockout:
    '<rect x="5.4" y="10.4" width="13.2" height="8.8" rx="2.2"/><path d="M8.6 10.4V8.2a3.4 3.4 0 0 1 6.8 0v2.2"/><path d="M12 13.8v2.2"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.2 2"/>',
  // A closed cycle: the intercept-jump-intercept loop a short grace produces.
  loop:
    '<path d="M6 12a6 6 0 0 1 6-6h5.2"/><path d="M14.8 3.4L17.6 6l-2.8 2.6"/><path d="M18 12a6 6 0 0 1-6 6H6.8"/><path d="M9.2 15.4L6.4 18l2.8 2.6"/>',
  chev: '<path d="M9.4 6.6l5.4 5.4-5.4 5.4"/>',
  // Brackets with a downward arrow: 「获取 URL 的内容」.
  fetch:
    '<path d="M9.4 5.2H6.6a1.4 1.4 0 0 0-1.4 1.4v10.8a1.4 1.4 0 0 0 1.4 1.4h2.8"/><path d="M14.6 5.2h2.8a1.4 1.4 0 0 1 1.4 1.4v10.8a1.4 1.4 0 0 1-1.4 1.4h-2.8"/><path d="M12 8v7.4"/><path d="M9.2 12.6L12 15.4l2.8-2.8"/>',
  // A flowchart decision: one diamond, two exits. 「如果」.
  branch: '<path d="M11.6 3.8l5.8 5.8-5.8 5.8-5.8-5.8z"/><path d="M11.6 15.4v4.8"/><path d="M17.4 9.6h3.4"/>',
  review: '<path d="M4.4 19.6h15.2"/><path d="M7.6 16.6v-4.4M12 16.6V5.8M16.4 16.6v-7.2"/>',
  settings:
    '<path d="M4.4 8.6h15.2M4.4 15.4h15.2"/><circle cx="9.4" cy="8.6" r="2.2"/><circle cx="14.8" cy="15.4" r="2.2"/>',
  lookup: '<circle cx="10.8" cy="10.8" r="5.6"/><path d="M15 15l4.4 4.4"/>',
  probe:
    '<circle cx="12" cy="12" r="8" stroke-dasharray="2.2 3"/><circle class="fillmark" cx="12" cy="12" r="2.6"/>',
  setup:
    '<path d="M4.6 7.8l1.7 1.7 2.7-3"/><path d="M4.6 15.6l1.7 1.7 2.7-3"/><path d="M12.4 8.6h7M12.4 16.4h7"/>',
  // A key rather than a person: this account IS a token.
  account: '<circle cx="8.8" cy="12" r="3.4"/><path d="M12.2 12h7.4"/><path d="M16.6 12v2.8M19.2 12v2"/>',
  admin: '<path d="M4.8 11.2l6.4-6.4h7.6v7.6l-6.4 6.4z"/><circle cx="15.4" cy="8.6" r="1.3"/>',
}

type Tier = 'verified' | 'listed' | 'derived'

/**
 * The 印 direction's one structural departure: the three tiers stop being ring
 * / page / broken-ring and become seals. A solid seal with the mark knocked out
 * reads as "stamped, settled"; a hairline seal as "recorded"; a seal drawn in
 * dashes as "not really a seal at all". Rotated a couple of degrees because a
 * stamp pressed by hand never lands square.
 */
const SEALS: Record<Tier, string> = {
  verified:
    '<g transform="rotate(-2 12 12)"><rect class="fillmark" x="3.2" y="3.2" width="17.6" height="17.6" rx="3.6"/><path class="knock" d="M8 12.5l2.8 2.6 5.2-5.9"/></g>',
  listed:
    '<g transform="rotate(-2 12 12)"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4"/><path d="M8 9.6h8M8 12.8h8M8 16h4.6"/></g>',
  derived:
    '<g transform="rotate(-2 12 12)"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4" stroke-dasharray="2.8 3.2"/><path d="M8.4 15.6l2.2-2.2M13.4 10.6l2.2-2.2"/></g>',
}

interface IconOpts {
  /** Present only when the icon stands alone; otherwise it is decorative. */
  label?: string
  cls?: string
}

function svgIcon(inner: string, o: IconOpts = {}): string {
  const a11y =
    o.label === undefined
      ? ' aria-hidden="true" focusable="false"'
      : ` role="img" aria-label="${escapeHtml(o.label)}"`
  return `<svg class="ic${o.cls ? ' ' + o.cls : ''}" viewBox="0 0 24 24"${a11y}>${inner}</svg>`
}

function icon(name: IconName, o: IconOpts = {}): string {
  return svgIcon(ICONS[name], o)
}

function tierIcon(tier: Tier, v: MockVariant, o: IconOpts = {}): string {
  return svgIcon(v === 'ink' ? SEALS[tier] : ICONS[tier], o)
}

/**
 * The footnote under each "after" pane, explaining where the words went.
 * `.why` is a flex row, so the prose MUST be wrapped in one element — a bare
 * text run beside an inline <span> becomes a second flex item and collapses
 * into a column.
 */
function why(inner: string): string {
  return `<p class="why">${icon('chev', { cls: 'chev tick' })}<span>${inner}</span></p>`
}

/** A summary row that hides its reasoning behind one tap. */
function fold(summary: string, inner: string): string {
  return `<details>
      <summary>${icon('chev', { cls: 'chev' })}${summary}</summary>
      ${inner}
    </details>`
}

// --- 1. one candidate row --------------------------------------------------

/**
 * Reproduced from lookup.ts as it renders today — the disclaimer box, the tag
 * strip, the caveat, the wide 「试着跳到 X」 button and the quiet 「就用这个」.
 * Copied rather than imported on purpose: the live module must not grow a
 * dependency on a mockup, and the whole value of this pane is that it is
 * verbatim.
 */
function candBefore(): string {
  return `<div class="warnbox">
  <b>这一页只是抄书</b>
  <p class="flat">下面每一条都<b>没有被验证过</b>。清单会过期，App 也会悄悄把 scheme 关掉，而且<b>猜错不会报错</b>——
  你会呼吸十秒、点「继续」，然后停在 Safari 里哪也去不了。所以顺序是：先点「试一下」，
  手机<b>真的跳进那个 App</b> 了，再点「就用这个」。</p>
  <p class="flat meta">清单快照抄于 ${SNAPSHOT_DATE}，之后的变动这里不知道。表里共 ${APPS.length} 个 App。</p>
</div>
<section class="card">
  <div class="card-head">
    <span class="name">小红书</span>
    <span class="key">xhs</span>
    <span class="badge">社交</span>
  </div>
  <p class="note flat">bundle id <span class="mono">com.xingin.discover</span></p>
  <div class="cand">
    <code class="mono cand-scheme">xhsdiscover://</code>
    <div class="tags">
      <span class="tag listed">清单收录 · 未验证</span>
      <span class="tag">两份清单一致</span>
      <a class="src" href="#">iOS-app-info</a>
      <a class="src" href="#">iOS-URL-Scheme</a>
    </div>
    <p class="caveat">两份清单都记着这一条，但没人验证过 2025 年之后的版本还响不响应它。</p>
    <button class="try" type="button">试着跳到「小红书」</button>
    <div class="actions">
      <span class="linky use">跳通了 · 就用这个</span>
      <span class="note flat">写进 <span class="mono">xhs</span> 这条配置</span>
    </div>
  </div>
</section>`
}

/**
 * The same row, rebuilt around three questions a reader actually has: how much
 * is this worth, what do I press first, where does it get written.
 *
 * The ordinals on the two buttons are the load-bearing part. Today the ordering
 * rule ("试一下 first, 就用这个 only after your phone really jumped") is a
 * sentence in the disclaimer three paragraphs up. Numbering the buttons puts
 * the same rule inside the thing it governs, which is why the disclaimer can
 * shrink to one line without losing it.
 */
function candAfter(v: MockVariant): string {
  return `<div class="strip">
  <p class="hl">${icon('caveat')}<span>下面每条都<b>没验证过</b> · 先试跳，通了再存</span></p>
  ${fold(
    '为什么不能直接存',
    `<p>清单会过期，App 会悄悄把 scheme 关掉，而且<b>猜错不会报错</b>——你会呼吸十秒、点「继续」，
      然后停在 Safari 里哪也去不了。快照抄于 ${SNAPSHOT_DATE} · 表里 ${APPS.length} 个 App。</p>`,
  )}
</div>
<section class="card">
  <div class="card-head">
    <span class="name">小红书</span>
    <span class="key">xhs</span>
    <span class="badge">社交</span>
  </div>
  <div class="c2-row">
    <span class="sig listed">${tierIcon('listed', v)}未验证</span>
    <code class="mono c2-scheme">xhsdiscover://</code>
  </div>
  <div class="c2-marks">
    <span class="mk">${icon('agree')}一致</span>
    <a class="mk" href="#" aria-label="两个来源">${icon('source')}2</a>
    <span class="mk dim">${icon('save')}xhs</span>
  </div>
  ${fold(
    '备注 · bundle id',
    `<p>两份清单都记着这一条，但没人验证过 2025 年之后的版本还响不响应它。</p>
      <p class="mono bid">com.xingin.discover</p>`,
  )}
  <div class="c2-acts">
    <button class="try2" type="button"><span class="ord">1</span>${icon('jump')}试跳「小红书」</button>
    <button class="use2" type="button"><span class="ord">2</span>${icon('save')}通了 · 存进 xhs</button>
  </div>
</section>
${why(`按钮上的 <span class="ord sm">1</span><span class="ord sm">2</span>
把「先试后存」这条规则搬进了按钮本身，所以顶上那段可以只留一行。
bundle id 和备注折进同一个「备注」里，来源名缩成图标加数量，「写进哪条配置」缩成图标加键名——三样都还在。`)}`
}

// --- 2. one setup step -----------------------------------------------------

/** Steps ① and ② plus the fail-open box, as /setup renders them today. */
function setupBefore(origin: string): string {
  return `<div class="doc">
<h3>① 「获取 URL 的内容」</h3>
<p>动作搜索框里搜 <code>URL</code>，选「获取 URL 的内容」。
把下面这一整条<b>粘进 URL 那一栏</b>（已经是你的真实地址和 token）：</p>
<pre class="copy tight">${origin}/gate?app=xhs&amp;k=…&amp;fmt=text</pre>
<p>展开「显示更多」，确认方法是 <code>GET</code>。请求头和请求体留空。</p>

<h3>② 「如果」</h3>
<pre class="shape">如果   「URL 的内容」   包含   https</pre>
<p>中间选<b>「包含」</b>，右边手打 <code>https</code> 五个字母。
左边那栏会自动接上一步的结果，不用动。</p>

<div class="box">
<h3>为什么条件是「包含 https」这么怪的写法</h3>
<p>服务器只回两种东西：该拦你时回一条 <code>https://…</code> 开头的网址，不该拦时回 <code>pass</code> 这个词。</p>
<p>所以这一条同时干了两件事：该拦时打开呼吸页；而<b>只要出任何问题</b>——服务挂了、
token 错了、网络断了、返回空白——结果里都没有 <code>https</code>，
「如果」不成立，快捷指令什么都不做，<b>你的 App 正常打开</b>。</p>
<p>所以<b>绝对不能反过来写成「不包含 pass」</b>。那样服务一挂，
每次开 App 都跳去一个打不开的网页，你会被自己写的工具锁在手机外面。</p>
</div>
</div>`
}

/**
 * Same three steps as a rail: an icon for the Shortcuts action, one line of
 * instruction, and the fiddly parameters as chips instead of prose. The chips
 * are where most of the deleted words went — 「展开显示更多，确认方法是 GET。
 * 请求头和请求体留空。」 is three assertions about three fields, which is a
 * shape a sentence is bad at and a row of chips is good at.
 *
 * The fail-open rule keeps a permanently visible line in the danger colour and
 * folds only its argument. Note the wording: the live page's later section
 * still says 「等于 block」/「不等于 pass」, which the gate stopped returning —
 * /gate?fmt=text answers with a URL or the word `pass`. Flagged in 取舍 below.
 */
function setupAfter(origin: string): string {
  return `<ol class="steps2">
  <li>
    <span class="no">1</span>
    <div class="sbody">
      <p class="shead">${icon('fetch')}获取 URL 的内容</p>
      <pre class="copy tight">${origin}/gate?app=xhs&amp;k=…&amp;fmt=text</pre>
      <p class="chips"><span class="chip">GET</span><span class="chip">请求头 空</span><span class="chip">请求体 空</span></p>
    </div>
  </li>
  <li>
    <span class="no">2</span>
    <div class="sbody">
      <p class="shead">${icon('branch')}如果 · 包含 <code>https</code></p>
      <p class="chips"><span class="chip">左栏 自动接</span><span class="chip">中间 包含</span><span class="chip">右栏 手打 https</span></p>
      <div class="hard">
        <p class="hl">${icon('lockout')}<span>条件<b>只能</b>写「包含 <code>https</code>」。写成「不包含 <code>pass</code>」，
        服务一挂就会把你<b>锁在手机外面</b>。</span></p>
        ${fold(
          '两种坏法为什么不对等',
          `<p>服务器只回两种东西：该拦你时回一条 <code>https://…</code>，不该拦时回 <code>pass</code>。
          写「包含 https」时，任何异常——服务挂了、token 错了、断网、返回空白——结果里都没有 https，
          「如果」不成立，快捷指令什么都不做，<b>你的 App 正常打开</b>，最坏结果是「今天没拦住你」。
          写「不包含 pass」则相反：服务一挂，每次开 App 都跳去一个打不开的网页，而你当时多半正急着用。
          同理，别给「获取 URL 的内容」加出错处理，也别加「否则」去打开任何东西。</p>`,
        )}
      </div>
    </div>
  </li>
  <li>
    <span class="no">3</span>
    <div class="sbody">
      <p class="shead">${icon('jump')}打开 URL · 拖进「如果」里面</p>
      <p class="chips"><span class="chip">URL 栏 自动接</span></p>
    </div>
  </li>
</ol>
<div class="flow" aria-label="建完是这三行">
  <span class="fl">${icon('fetch')}取内容</span>${icon('chev', { cls: 'ar' })}
  <span class="fl">${icon('branch')}含 https</span>${icon('chev', { cls: 'ar' })}
  <span class="fl">${icon('jump')}打开</span>
  <span class="fl end">否则什么都不做</span>
</div>
${why(`三段解释变成一行加三个 chip，代码块原样保留——那是要粘的东西，不能变短。
fail-open 那段<b>一行常显、理由折叠</b>，因为它是全站唯一一段「读错会伤人」的字。`)}`
}

// --- 3. the three tiers ----------------------------------------------------

function tiersBefore(): string {
  return `<div class="tags">
  <span class="tag verified">实测跳通过</span>
  <span class="tag listed">清单收录 · 未验证</span>
  <span class="tag derived">推导 · 很可能不对</span>
</div>
<p class="caveat">这三个 pill 每一行都会出现一次，长度不等，换行位置随机；三档之间的差别靠读字，
不靠看。「两份清单一致」再加一个 pill，一行经常挤成两行。</p>`
}

function tiersAfter(v: MockVariant): string {
  return `<ul class="tiers">
  <li class="t-verified"><span class="sigbig">${tierIcon('verified', v, { cls: 'lg', label: '实测跳通过' })}</span>
    <b>跳通过</b><span class="tm">你自己的手机真的跳进去过</span></li>
  <li class="t-listed"><span class="sigbig">${tierIcon('listed', v, { cls: 'lg', label: '清单收录，未验证' })}</span>
    <b>未验证</b><span class="tm">清单里抄来的，可能已经失效</span></li>
  <li class="t-derived"><span class="sigbig">${tierIcon('derived', v, { cls: 'lg', label: '推导，很可能不对' })}</span>
    <b>大概不对</b><span class="tm">照 bundle id 硬推的，跳不通是常态</span></li>
</ul>
<p class="marks-demo">
  <span class="mk">${icon('agree')}一致</span>
  <span class="mk">${icon('source')}2</span>
  <span class="mk dim">${icon('save')}xhs</span>
  <span class="mk cav">${icon('caveat')}备注</span>
</p>
${why(`三句解释只在这里说一次，候选行里只剩图标加两三个字。
${v === 'ink' ? '印章的实心／发丝／断线三种状态' : '闭环／书页／断环三种形状'}在缩到 16px 时还能分得开——
这是选形状的唯一标准，不是好不好看。`)}`
}

// --- 4. the console nav ----------------------------------------------------

function navBefore(): string {
  return `<header class="old">
  <span class="brand">一息</span>
  <span class="who">jinkun</span>
  <nav>
    <a href="#">回顾</a>
    <a href="#" class="on">设置</a>
    <a href="#">候选</a>
    <a href="#">实测</a>
    <a href="#">怎么配</a>
    <a href="#">账号</a>
    <a href="#">发号</a>
  </nav>
</header>
<p class="caveat">六到七个纯文字 tab 一行放不下，靠 <code>overflow-x:auto</code> 滚。
后面两个在手机上默认看不见，而且滚动条是隐藏的——不知道它能滚。</p>`
}

function navAfter(v: MockVariant): string {
  const items: Array<[IconName, string, boolean]> = [
    ['review', '回顾', false],
    ['settings', '设置', true],
    ['lookup', '候选', false],
    ['probe', '实测', false],
    ['setup', '怎么配', false],
    ['account', '账号', false],
    ['admin', '发号', false],
  ]
  const row = (): string =>
    items
      .map(
        ([name, label, on]) =>
          `<a href="#"${on ? ' class="on" aria-current="page"' : ''} aria-label="${label}">${icon(name)}<span class="lb">${label}</span></a>`,
      )
      .join('')

  return `<p class="opt">方案 A · 只有当前页带字</p>
<header class="nav2">
  <span class="brand">一息</span>
  <nav aria-label="导航">${row()}</nav>
</header>

<p class="opt">方案 B · 全部带小字，两行</p>
<header class="nav2 labels">
  <span class="brand">一息</span>
  <nav aria-label="导航">${row()}</nav>
</header>

${why(`两个都不用横向滚。我更推 <b>B</b>：
「候选」和「实测」在语义上是同一件事的两步（找字符串／试字符串），
只给图标很难分开，${v === 'ink' ? '印章' : '线稿'}再准也补不回那两个字。
A 好看，B 好用——这一条我想听你拍板。`)}`
}

// --- 5. the grace-seconds note --------------------------------------------

function graceBefore(): string {
  return `<div class="row">
  <div class="field">
    <label for="mock-wait-before">等待 · 秒</label>
    <input id="mock-wait-before" type="number" value="10" readonly>
  </div>
  <div class="field">
    <label for="mock-grace-before">免打扰 · 秒</label>
    <input id="mock-grace-before" type="number" value="90" readonly>
  </div>
</div>
<p class="note note-tight">「免打扰」是点了「继续」之后不再拦你的时长，<b>建议 90 秒</b>。它同时解决了跳回 App
会再次触发自动化的死循环——这段时间内的触发算机器噪音，不进统计。设得太短（几秒）会让你刚跳回 App 就又被拦。</p>`
}

function graceAfter(v: MockVariant): string {
  return `<div class="row">
  <div class="field">
    <label for="mock-wait-after">${icon('clock')}等待 · 秒</label>
    <input id="mock-wait-after" type="number" value="10" readonly>
  </div>
  <div class="field">
    <label for="mock-grace-after">${icon('loop')}免打扰 · 秒</label>
    <input id="mock-grace-after" type="number" value="90" readonly>
  </div>
</div>
<div class="hint">
  <p class="hl">${icon('loop')}<span>建议 <span class="num">90</span>。太短会让你<b>刚跳回 App 就又被拦</b>。</span></p>
  ${fold(
    '它到底管什么',
    '<p>点了「继续」之后这段时间内不再拦你。它同时解决了跳回 App 会再次触发自动化的死循环——这段时间内的触发算机器噪音，不进统计。</p>',
  )}
</div>
${why(`那个${v === 'ink' ? '回环印记' : '回环'}就是「刚跳回又被拦」这件事本身，
所以警告能压成一行；「不进统计」这类背景折起来，需要的人才展开。`)}`
}

// --- closing -------------------------------------------------------------

function tradeoffs(v: MockVariant): string {
  return `<section class="cmp closing">
  <h2><span class="n">${v === 'ink' ? '印' : '线'}</span>这一版删了什么、折了什么</h2>
  <ul class="ledger">
    <li>${icon('caveat')}<span><b>没删</b>，压成一行 + 折叠：「这些只是候选，跳得通的才算数」。规则本身还搬进了按钮的 <span class="ord sm">1</span><span class="ord sm">2</span>。</span></li>
    <li>${icon('lockout')}<span><b>没删</b>，一行常显 + 折叠理由：fail-open。写反了会把你锁在手机外面，这段字不该靠图标承担。</span></li>
    <li>${icon('loop')}<span><b>没删</b>，一行常显 + 折叠背景：免打扰太短会刚跳回就又被拦。</span></li>
    <li>${icon('agree')}<span><b>真删了</b>：三档置信度在每行重复的解释（挪进 3 的图例，只说一次）；「展开显示更多」这类操作旁白（变成 chip）；「写进 xxx 这条配置」（变成图标 + 键名）。</span></li>
  </ul>
  ${fold(
    '顺手发现的一处线上文案 bug',
    `<p>/setup 后半段「坏掉的时候必须放你进去」写的是「第一步<b>④</b>的条件写的是<b>等于 block</b>」、
    「永远不要改成不等于 pass」。但 <code>/gate?fmt=text</code> 现在只回一条 <code>https://…</code> 或者 <code>pass</code>，
    <b>不回 block</b>，而且第一步只有三个动作、没有④。前半段的「包含 https」是对的，这一段是旧协议留下的。
    照它改的人会把条件写成永远不成立——那是「永远不拦」，不至于锁死，但整个产品失效且没有任何报错。
    这一页按正确的说法（包含 https）画，但<b>真页面得单独修一次</b>。</p>`,
  )}
</section>`
}

// --- styles ---------------------------------------------------------------

/**
 * Copied out of LOOKUP_CSS and SETUP_CSS so the "before" panes look exactly
 * like the live pages rather than approximately like them. Copies, not imports:
 * those constants are private to their modules and a mockup has no business
 * making them public.
 */
const LEGACY_CSS = `
.warnbox{border:1px solid var(--rule);border-radius:14px;padding:14px;margin:0 0 18px;
  font-size:13px;line-height:1.75;color:var(--dim)}
.warnbox b{color:var(--fg)}
.warnbox p{margin:8px 0 0}
.warnbox .meta{font-size:11.5px;color:var(--faint);margin-top:10px}
.cand{border-top:1px solid var(--rule);padding:14px 0 2px;margin:0}
.cand-scheme{display:block;word-break:break-all;font-size:14px;margin:0 0 9px}
.tags{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:0 0 8px;font-size:11px;line-height:1.9}
.tag{border:1px solid var(--rule);border-radius:99px;padding:1px 9px;color:var(--dim);
  white-space:nowrap;letter-spacing:.06em;text-decoration:none}
.tag.derived{border-color:var(--danger);color:var(--danger)}
.tag.verified{background:var(--stop-bg);color:var(--stop-fg);border-color:var(--stop-border)}
.src{color:var(--faint);font-size:11px;text-decoration:underline;text-underline-offset:3px}
.caveat{font-size:12px;line-height:1.75;color:var(--dim);margin:0 0 10px}
.try{width:100%;background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  border-radius:12px;padding:14px 18px;font-size:15px;font-weight:600;min-height:52px}
.cand .actions{gap:10px;justify-content:space-between}
.cand .actions .note{text-align:right}
.linky.use{color:var(--dim);font-size:13px;text-decoration:underline;text-underline-offset:3px}
.doc h3{margin:1.4rem 0 .5rem;font-size:.95rem;font-weight:400;color:var(--fg)}
.doc h3:first-child{margin-top:0}
.doc p{margin:0 0 .9rem;line-height:1.85;opacity:.9;font-size:13.5px}
.doc code,.sbody code,.hard code,.why code,.ledger code{font-family:var(--num);font-size:.86em;
  background:var(--rule);border-radius:4px;padding:.1em .38em}
pre.copy,pre.shape{font-family:var(--num);font-size:.78rem;line-height:1.7;
  background:var(--rule);border-radius:10px;padding:11px 13px;margin:0 0 .9rem;
  overflow-x:auto;white-space:pre;-webkit-user-select:all;user-select:all}
pre.copy.tight{font-size:.7rem;padding:9px 11px}
.box{border:1px solid var(--rule);border-radius:12px;padding:13px 15px 4px;margin:0 0 1rem}
.box h3{margin:0 0 .5rem;font-size:.88rem;color:var(--dim)}
`

const MOCK_CSS = `
main.mock{max-width:820px}
main.mock h1{font-size:19px;margin:14px 0 8px}
main.mock > .lede{margin-bottom:10px}
.vnote{font-size:12px;line-height:1.8;color:var(--faint);border-left:2px solid var(--rule);
  padding-left:11px;margin:0 0 26px}

/* --- variant switcher --- */
.uibar{display:flex;align-items:baseline;gap:9px;padding:22px 0 4px;max-width:none;margin:0}
.uibar .brand{font-size:17px}
.uibar .ub-label{margin-left:auto;font-size:11px;letter-spacing:.14em;color:var(--faint)}
.uibar a{text-decoration:none;padding:3px 13px;border-radius:999px;border:1px solid var(--rule);
  color:var(--faint);font-size:13px}
.uibar a[aria-current="true"]{color:var(--fg);border-color:var(--fg)}
.v-ink .uibar a{border-radius:5px}

/* --- comparison scaffolding --- */
.cmp{margin:0 0 34px}
.cmp h2{display:flex;align-items:center;gap:9px;margin:0 0 6px;font-size:14px;color:var(--fg);letter-spacing:.04em}
.cmp h2 .n{flex:none;width:21px;height:21px;border-radius:50%;border:1px solid var(--rule);
  display:flex;align-items:center;justify-content:center;font-family:var(--num);font-size:11px;color:var(--dim)}
.v-ink .cmp h2 .n{border-radius:5px}
.clede{font-size:12.5px;line-height:1.8;color:var(--faint);margin:0 0 12px}
.panes{display:grid;gap:12px}
@media (min-width:720px){.panes{grid-template-columns:1fr 1fr;align-items:start}}
.pane{border:1px solid var(--rule);border-radius:14px;padding:13px 13px 15px;min-width:0}
.pane.after{border-color:var(--ring-prog)}
.v-ink .pane{border-radius:9px}
.plabel{display:inline-block;font-size:10.5px;letter-spacing:.18em;color:var(--faint);margin:0 0 11px}
.pane.after .plabel{color:var(--dim)}
.pane .card{margin-bottom:0}
.pane header.old,.pane header.nav2{max-width:none;margin:0;padding:0}
.pane header.old{margin-bottom:12px}
/* The "before" pane is narrower than the real 520px console, and a shrinking
   brand would make today's header look worse than it is. Pin it and let the
   nav do what it actually does on a phone: scroll out of sight. */
.pane header.old .brand,.pane header.old .who{flex:none}
hr.sep{margin:34px 0 20px}
.brush{display:block;width:100%;height:9px;fill:currentColor;stroke:none;opacity:.2;margin:34px 0 20px}

/* --- icon system --- */
.ic{width:16px;height:16px;flex:none;display:inline-block;vertical-align:-.2em;
  fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.v-ink .ic{stroke-width:2.1}
.ic.lg{width:21px;height:21px}
.ic.ar{width:12px;height:12px;color:var(--faint);stroke-width:1.4}
.ic .fillmark{fill:currentColor;stroke:none}
.ic .knock{stroke:var(--bg);stroke-width:2.5}
.v-ink .ic .knock{stroke-width:2.6}

/* --- folds --- */
details{margin:7px 0 0}
summary{display:inline-flex;align-items:center;gap:6px;cursor:pointer;list-style:none;
  font-size:11.5px;letter-spacing:.04em;color:var(--faint)}
summary::-webkit-details-marker{display:none}
summary::marker{content:""}
details[open] > summary{color:var(--dim)}
summary .ic.chev{width:12px;height:12px;transition:transform .18s ease}
details[open] > summary .ic.chev{transform:rotate(90deg)}
details > p{margin:8px 0 0;font-size:12.5px;line-height:1.85;color:var(--dim)}
details > p b{color:var(--fg)}

/* --- candidate, after --- */
.strip{border:1px solid var(--rule);border-radius:12px;padding:10px 12px;margin:0 0 12px;
  font-size:12.5px;line-height:1.7;color:var(--dim)}
.v-ink .strip{border-radius:7px}
.strip b{color:var(--fg)}
.hl{display:flex;gap:8px;align-items:flex-start;margin:0}
.hl .ic{margin-top:3px}
.c2-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 8px}
.c2-scheme{word-break:break-all;font-size:13.5px;-webkit-user-select:all;user-select:all}
.sig{display:inline-flex;align-items:center;gap:5px;font-size:11px;letter-spacing:.06em;
  white-space:nowrap;color:var(--dim)}
.sig.verified{color:var(--fg)}
.sig.derived{color:var(--danger)}
.c2-marks{display:flex;flex-wrap:wrap;gap:6px;margin:0}
.mk{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dim);
  text-decoration:none;border:1px solid var(--rule);border-radius:99px;padding:1.5px 9px;white-space:nowrap}
.mk.dim{color:var(--faint)}
.mk.cav{color:var(--dim)}
.v-ink .mk{border-radius:4px}
.c2-acts{display:flex;flex-direction:column;align-items:center;gap:0;margin-top:13px}
.try2{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:8px;
  background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  border-radius:12px;padding:13px 16px;font-size:15px;font-weight:600;min-height:50px}
.try2:active{opacity:.72}
.v-ink .try2{border-radius:6px}
.use2{display:inline-flex;align-items:center;gap:7px;color:var(--dim);font-size:13px;
  padding:12px 0 2px;min-height:44px}
.ord{display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:17px;height:17px;border-radius:50%;border:1px solid currentColor;
  font-family:var(--num);font-size:10.5px;font-weight:400;opacity:.72}
.v-ink .ord{border-radius:3px}
.ord.sm{width:15px;height:15px;font-size:9.5px;vertical-align:-.15em}
.why{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.8;
  color:var(--faint);margin:13px 0 0;border-top:1px solid var(--rule);padding-top:10px}
.why b{color:var(--dim)}
.bid{font-size:11.5px;color:var(--faint);margin:6px 0 0;-webkit-user-select:all;user-select:all}
.why .ic.tick{margin-top:4px;transform:rotate(90deg);opacity:.7}

/* --- setup, after --- */
.steps2{list-style:none;margin:0;padding:0}
.steps2 li{display:flex;gap:10px;padding:0 0 15px}
.steps2 .no{flex:none;width:20px;height:20px;border-radius:50%;border:1px solid var(--rule);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--num);font-size:11px;color:var(--dim);margin-top:2px}
.v-ink .steps2 .no{border-radius:4px}
.sbody{flex:1;min-width:0}
.shead{display:flex;align-items:center;gap:7px;margin:0 0 8px;font-size:14px;line-height:1.5}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0}
.chip{font-size:10.5px;color:var(--dim);border:1px solid var(--rule);border-radius:99px;
  padding:1.5px 9px;white-space:nowrap;font-family:var(--num);letter-spacing:.04em}
.v-ink .chip{border-radius:3px}
.hard{border-left:2px solid var(--danger);padding:1px 0 1px 10px;margin:11px 0 0;
  font-size:12.5px;line-height:1.75;color:var(--dim)}
.hard .ic{color:var(--danger)}
.hard b{color:var(--danger)}
.flow{display:flex;align-items:center;gap:7px;flex-wrap:wrap;
  border:1px solid var(--rule);border-radius:12px;padding:10px 12px;margin:2px 0 0}
.v-ink .flow{border-radius:7px}
.fl{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dim);white-space:nowrap}
.fl.end{color:var(--faint);font-size:11px;margin-left:auto}

/* --- tiers, after --- */
.tiers{list-style:none;margin:0;padding:0}
.tiers li{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--rule)}
.tiers li:first-child{border-top:0;padding-top:2px}
.sigbig{display:inline-flex;flex:none;color:var(--dim)}
.tiers b{flex:none;min-width:4.2em;font-size:13px;font-weight:600;color:var(--fg)}
.tiers .tm{font-size:11.5px;line-height:1.6;color:var(--faint)}
.t-verified .sigbig{color:var(--fg)}
.t-derived .sigbig{color:var(--danger)}
.t-derived b{color:var(--danger)}
.marks-demo{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 0}

/* --- nav, after --- */
.opt{font-size:10.5px;letter-spacing:.14em;color:var(--faint);margin:0 0 7px}
.pane header.nav2{display:flex;align-items:center;gap:6px;margin:0 0 16px}
.nav2 .brand{flex:none;font-size:14px;letter-spacing:.1em;text-indent:.1em}
/* Wrapping is a safety net, not the design: seven items are sized to fit one
   row inside a 375px phone, and wrapping only ever beats a horizontal scroll
   the reader cannot see. */
.nav2 nav{margin-left:auto;display:flex;align-items:flex-end;justify-content:flex-end;
  flex-wrap:wrap;gap:1px;min-width:0}
.nav2 nav a{display:inline-flex;align-items:center;gap:5px;padding:7px 6px;
  color:var(--faint);text-decoration:none;font-size:12px;border-radius:9px}
.nav2 nav a .lb{display:none}
.nav2 nav a.on{color:var(--fg)}
.nav2 nav a.on .lb{display:inline}
.v-line .nav2 nav a.on{box-shadow:inset 0 -1px 0 var(--fg)}
.v-ink .nav2 nav a.on{background:var(--ring-track);border-radius:6px}
.nav2.labels nav a{flex-direction:column;gap:3px;padding:5px 3px}
.nav2.labels nav a .lb{display:inline;font-size:9.5px;letter-spacing:0;white-space:nowrap}
.nav2.labels nav a.on{color:var(--fg)}

/* --- grace, after --- */
.pane .field label{display:flex;align-items:center;gap:6px}
.pane input[readonly]{color:var(--dim)}
.hint{font-size:12.5px;line-height:1.75;color:var(--dim);margin:2px 0 0}
.hint b{color:var(--fg)}
.hint .ic{color:var(--dim)}

/* --- closing ledger --- */
.closing h2 .n{font-family:var(--font);letter-spacing:0}
.ledger{list-style:none;margin:0;padding:0}
.ledger li{display:flex;gap:9px;align-items:flex-start;padding:9px 0;
  border-top:1px solid var(--rule);font-size:12.5px;line-height:1.8;color:var(--dim)}
.ledger li:first-child{border-top:0}
.ledger .ic{margin-top:4px;flex:none}
.ledger b{color:var(--fg)}
`
