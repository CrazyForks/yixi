/**
 * Shared HTML shell and design tokens for every page 一息 serves.
 *
 * Hard constraint: ZERO external requests. No CDN, no web font, no image file,
 * not even a favicon fetch (see the `data:` icon below). Someone opens this page
 * in the exact moment they are reaching for a distraction, often on a bad
 * connection — a single blocking round-trip would defeat the product. Everything
 * ships inline in the first response.
 *
 * Two visual skins live side by side until the owner picks one at /mock:
 *   'ink'    — v1 「墨」  a slow wash of ink breathing in the dark
 *   'breath' — v2 「息」  a hairline ring and a single dot, nothing else
 * They share all markup and all JavaScript; only the tokens below differ.
 */

export type ThemeName = 'ink' | 'breath'

/**
 * What /b renders until the owner compares both skins on-device and decides.
 * Flip this one constant to switch the product's face.
 */
export const DEFAULT_THEME: ThemeName = 'ink'

interface ThemeDef {
  /** Human-facing name, used on the /mock switcher. */
  title: string
  /** Safari address-bar tint, per colour scheme. */
  barLight: string
  barDark: string
  /** Custom-property block, light defaults plus a dark override. */
  tokens: string
}

const THEMES: Record<ThemeName, ThemeDef> = {
  // v1 「墨」 — the canonical look is dark: pale ink drifting on near-black.
  // Light mode is not a washed-out copy of that; it inverts into what ink
  // actually is on paper — dark wash on a 宣纸 ground.
  ink: {
    title: '墨',
    barLight: '#f3f0e8',
    barDark: '#0d0f11',
    tokens: `
:root{
  --bg:#f3f0e8;
  --fg:#1f1c18;
  --dim:rgba(31,28,24,.56);
  --faint:rgba(31,28,24,.30);
  --rule:rgba(31,28,24,.12);
  --ring-track:rgba(31,28,24,.09);
  --ring-prog:rgba(31,28,24,.42);
  --stop-bg:#1f1c18;
  --stop-fg:#f3f0e8;
  --stop-border:#1f1c18;
  --go-fg:rgba(31,28,24,.52);
  --ink-a:rgba(26,24,22,.58);
  --ink-b:rgba(26,24,22,.13);
  --dot:#1f1c18;
  --ink-blur:16px;
  --font:"Songti SC","Source Han Serif SC","Noto Serif CJK SC",STSong,"SimSun",Georgia,"Times New Roman",serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0d0f11;
    --fg:rgba(238,235,228,.92);
    --dim:rgba(238,235,228,.50);
    --faint:rgba(238,235,228,.26);
    --rule:rgba(238,235,228,.10);
    --ring-track:rgba(238,235,228,.08);
    --ring-prog:rgba(238,235,228,.38);
    --stop-bg:rgba(238,235,228,.93);
    --stop-fg:#0d0f11;
    --stop-border:transparent;
    --go-fg:rgba(238,235,228,.42);
    --ink-a:rgba(223,231,236,.30);
    --ink-b:rgba(142,166,184,.07);
    --dot:rgba(238,235,228,.92);
    --ink-blur:20px;
  }
}`,
  },

  // v2 「息」 — no decoration at all. A hairline ring, a dot, a lot of nothing.
  breath: {
    title: '息',
    barLight: '#fbfaf8',
    barDark: '#0f1011',
    tokens: `
:root{
  --bg:#fbfaf8;
  --fg:#17181a;
  --dim:rgba(23,24,26,.50);
  --faint:rgba(23,24,26,.26);
  --rule:rgba(23,24,26,.10);
  --ring-track:rgba(23,24,26,.09);
  --ring-prog:rgba(23,24,26,.62);
  --stop-bg:#17181a;
  --stop-fg:#fbfaf8;
  --stop-border:#17181a;
  --go-fg:rgba(23,24,26,.45);
  --ink-a:rgba(23,24,26,.40);
  --ink-b:rgba(23,24,26,.08);
  --dot:#17181a;
  --ink-blur:16px;
  --font:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,"Helvetica Neue",sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0f1011;
    --fg:#eceae7;
    --dim:rgba(236,234,231,.50);
    --faint:rgba(236,234,231,.26);
    --rule:rgba(236,234,231,.11);
    --ring-track:rgba(236,234,231,.10);
    --ring-prog:rgba(236,234,231,.66);
    --stop-bg:#eceae7;
    --stop-fg:#0f1011;
    --stop-border:transparent;
    --go-fg:rgba(236,234,231,.44);
    --ink-a:rgba(236,234,231,.34);
    --ink-b:rgba(236,234,231,.06);
    --dot:#eceae7;
  }
}`,
  },
}

export function themeTitle(name: ThemeName): string {
  return THEMES[name].title
}

/** `?v=1` -> ink, `?v=2` -> breath, anything else -> the current default. */
export function themeFromParam(v: string | null): ThemeName {
  if (v === '1' || v === 'ink') return 'ink'
  if (v === '2' || v === 'breath') return 'breath'
  return DEFAULT_THEME
}

export function themeParam(name: ThemeName): '1' | '2' {
  return name === 'ink' ? '1' : '2'
}

/**
 * The one and only external origin this product is allowed to talk to, and the
 * single break in the "zero external requests" rule at the top of this file.
 *
 * WHY THE EXCEPTION EXISTS. /register is open to anyone who reads the (public)
 * README, and a per-IP throttle alone does not stop a script spread over a few
 * hundred addresses. Turnstile is the only bot check available that does not
 * require running one, and its widget is a script served from Cloudflare's own
 * host — there is no self-hosted build of it. So the choice was "no bot
 * protection" or "one external origin on one page", and this is the second.
 *
 * WHERE THE BREAK IS. Exactly one page, exactly one origin, and only while
 * Turnstile is configured: `pageOptions.turnstile` is what widens the policy,
 * and only src/ui/account.ts's /register handler ever sets it — and only when
 * both keys are present. Every other page (the breathing page, /review,
 * /setup, /settings, /login, /claim, /recover, the landing
 * page) is served with the byte-identical `default-src 'none'` policy it had
 * before Turnstile existed, so none of them can reach any external host. That
 * is a property of the code rather than a promise: the flag that relaxes the
 * CSP is the same flag that emits the loader, so neither can appear without the
 * other, and no caller can name a different host.
 */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

/** `async defer`: it must never be on the critical path of rendering the form. */
const TURNSTILE_LOADER = `<script src="${TURNSTILE_ORIGIN}/turnstile/v0/api.js" async defer></script>`

/**
 * Content-Security-Policy is how the "zero external requests" rule stops being
 * a promise and starts being enforced: nothing may load from anywhere.
 *
 * `connect-src 'self'` is load-bearing — sendBeacon('/resolve') is a connect-src
 * fetch and would be blocked without it. Note that no directive here restricts
 * the top-level `location.href = 'xhsdiscover://'` jump; `navigate-to` was never
 * shipped by any browser, so the scheme hand-off is untouched by this policy.
 *
 * With `turnstile` on, three directives gain `TURNSTILE_ORIGIN` and nothing
 * else: `script-src` for api.js, `frame-src` for the iframe the widget actually
 * draws itself in (without it the challenge silently never appears, because
 * frame-src falls back to `default-src 'none'`), and `connect-src` for the
 * calls api.js makes back to its own host while solving. `default-src 'none'`
 * still covers everything else even on that page.
 */
function contentSecurityPolicy(turnstile: boolean): string {
  const external = turnstile ? ` ${TURNSTILE_ORIGIN}` : ''
  const directives = [
    "default-src 'none'",
    `script-src 'unsafe-inline'${external}`,
    "style-src 'unsafe-inline'",
    `connect-src 'self'${external}`,
    'img-src data:',
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]
  if (turnstile) directives.push(`frame-src ${TURNSTILE_ORIGIN}`)
  return directives.join('; ')
}

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%;color-scheme:light dark}
body{
  min-height:100vh;
  min-height:100svh;
  background:var(--bg);
  color:var(--fg);
  font-family:var(--font);
  font-size:16px;
  line-height:1.8;
  -webkit-font-smoothing:antialiased;
  overscroll-behavior:none;
  -webkit-tap-highlight-color:transparent;
}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-appearance:none;appearance:none;touch-action:manipulation}
a{color:inherit}
::selection{background:var(--fg);color:var(--bg)}
.sp{letter-spacing:.28em;text-indent:.28em}
`

export interface PageOptions {
  title: string
  theme: ThemeName
  /** Page-specific CSS, appended after the reset and the theme tokens. */
  css?: string
  body: string
  /** Inline script, injected at the end of <body>. No modules, no imports. */
  script?: string
  bodyAttrs?: string
  status?: number
  /** Defaults to `no-store`; session pages must never be replayed from cache. */
  cacheControl?: string
  /**
   * Load the Turnstile widget script and widen the CSP by exactly one origin.
   * The only caller is /register, and only when a widget is configured. One flag
   * for both halves on purpose — a page cannot end up with the loader and no
   * policy for it, or a relaxed policy it does not use.
   */
  turnstile?: boolean
  /**
   * Let search engines index this page. Defaults to false, which emits
   * `noindex,nofollow`.
   *
   * Default-deny is the point. Every page here except the landing page is
   * either somebody's own record (/review, /settings, /account) or a URL with
   * a live session in it (/b?s=…, /claim, /recover) — none of that belongs in
   * an index, and a page added later should be private until somebody decides
   * otherwise rather than the other way round.
   */
  indexable?: boolean
  /**
   * `<meta name="description">` and `og:description`. Without one, a search
   * engine writes its own snippet out of whatever text it finds first, which
   * on the landing page is the in-app-browser warning.
   */
  description?: string
  /**
   * Absolute URL of this page, for `<link rel="canonical">` and `og:url`.
   * Pass the live request's own origin — hardcoding the public instance would
   * make every self-hosted copy declare somebody else's domain as canonical
   * and hand it the ranking.
   */
  canonical?: string
}

/**
 * The description/canonical/Open Graph block, empty unless the caller asked
 * for one. Kept out of the template above because it is the only part of the
 * head that is conditional in three different ways, and inlining it there
 * turns a readable document into a nest of ternaries.
 */
function socialTags(o: PageOptions): string {
  const tags: string[] = []
  if (o.description) tags.push(`<meta name="description" content="${escapeHtml(o.description)}">`)
  if (o.canonical) tags.push(`<link rel="canonical" href="${escapeHtml(o.canonical)}">`)
  // og:* only for a page that is meant to be seen by strangers. A private page
  // has nothing to gain from a rich unfurl and something to lose: chat clients
  // fetch these URLs server-side, so a session page would be opened by a bot.
  if (o.indexable) {
    tags.push(`<meta property="og:title" content="${escapeHtml(o.title)}">`)
    if (o.description) tags.push(`<meta property="og:description" content="${escapeHtml(o.description)}">`)
    if (o.canonical) tags.push(`<meta property="og:url" content="${escapeHtml(o.canonical)}">`)
    tags.push('<meta property="og:type" content="website">')
    tags.push('<meta name="twitter:card" content="summary">')
  }
  return tags.length > 0 ? '\n' + tags.join('\n') : ''
}

export function pageHtml(o: PageOptions): string {
  const t = THEMES[o.theme]
  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme:light)" content="${t.barLight}">
<meta name="theme-color" media="(prefers-color-scheme:dark)" content="${t.barDark}">
${o.indexable ? '' : '<meta name="robots" content="noindex,nofollow">\n'}<link rel="icon" href="data:,">
<title>${escapeHtml(o.title)}</title>${socialTags(o)}
<style>${t.tokens}${BASE_CSS}${o.css ?? ''}</style>${o.turnstile ? '\n' + TURNSTILE_LOADER : ''}
</head>
<body${o.bodyAttrs ? ' ' + o.bodyAttrs : ''}>
${o.body}
${o.script ? `<script>${o.script}</script>` : ''}
</body>
</html>`
}

export function page(o: PageOptions): Response {
  return new Response(pageHtml(o), {
    status: o.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': o.cacheControl ?? 'no-store',
      'content-security-policy': contentSecurityPolicy(o.turnstile === true),
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  })
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Config handed to the inline script as an inert JSON island rather than as
 * generated JavaScript. App labels and URL schemes are user-supplied (via
 * /settings), so they must never be able to become code: `<` is escaped so the
 * payload cannot close the tag, and U+2028/2029 so it cannot break the string.
 */
export function jsonScript(id: string, value: unknown): string {
  const json = JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `<script type="application/json" id="${id}">${json}</script>`
}
