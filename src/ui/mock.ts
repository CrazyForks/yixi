import { breathePage } from './breathe'
import { themeFromParam, themeParam, themeTitle, type ThemeName } from './layout'
import { localeOf, translator, type T } from '../i18n'

/**
 * /mock — the two candidate looks, side by side, so the owner can hold the phone
 * in a dark room and in daylight and pick one. Unauthenticated on purpose: this
 * page has no session, sends no beacon and navigates nowhere.
 *
 * It renders through the real `breathePage`, not a copy, so what is being judged
 * is exactly what /b will serve. Only `sid` (null) and `scheme` ('') differ.
 *
 *   /mock?v=1        「墨」
 *   /mock?v=2        「息」
 *   /mock?v=1&wait=3  short wait, for iterating on the button timing
 *   /mock?v=2&label=微博
 */
export function renderMock(request: Request): Response {
  const url = new URL(request.url)
  // No session here and so no account to ask: this page follows the request,
  // which is the `?lang=` cookie the router has already set, or the browser.
  const loc = localeOf(request, null)
  const t = translator(loc)
  const theme = themeFromParam(url.searchParams.get('v') ?? '1')
  const wait = parseWait(url.searchParams.get('wait'))
  const label = parseLabel(url.searchParams.get('label'), t)

  return breathePage({
    theme,
    label,
    waitSeconds: wait,
    sid: null,
    scheme: '',
    lang: loc,
    farewell: t('好，就到这里。'),
    wentMain: t('这里会跳回{label}。', { label }),
    wentSub: t('预览页不跳转。'),
    extraCss: MOCK_CSS,
    extraBody: switcher(theme, wait, label, t),
  })
}

function parseWait(raw: string | null): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 10
  return Math.max(0, Math.min(60, Math.round(n)))
}

function parseLabel(raw: string | null, t: T): string {
  const s = (raw ?? '').trim()
  // Escaped downstream by breathePage; the cap is just to keep the layout sane.
  // The fallback is an example rather than data, so it changes with the
  // language — a label somebody actually typed never does.
  return s.length > 0 && s.length <= 16 ? s : t('小红书')
}

function switcher(current: ThemeName, wait: number, label: string, t: T): string {
  const link = (name: ThemeName): string => {
    const q = new URLSearchParams({ v: themeParam(name), wait: String(wait), label })
    const here = name === current
    return `<a href="/mock?${q.toString()}"${here ? ' aria-current="true"' : ''}>${themeTitle(name, t)}</a>`
  }
  const again = new URLSearchParams({
    v: themeParam(current),
    wait: String(wait),
    label,
  })
  return `<nav class="mockbar" aria-label="${t('视觉预览')}">
<span>${t('预览')}</span>${link('ink')}${link('breath')}<a href="/mock?${again.toString()}">${t('再看一次')}</a>
</nav>`
}

const MOCK_CSS = `
.mockbar{
  position:fixed;z-index:9;left:0;right:0;
  top:calc(env(safe-area-inset-top) + 10px);
  display:flex;gap:8px;align-items:center;justify-content:center;
  font-size:.7rem;letter-spacing:.12em;color:var(--faint);
}
.mockbar span{opacity:.7;margin-right:2px}
.mockbar a{
  text-decoration:none;padding:3px 11px;border-radius:999px;
  border:1px solid var(--rule);color:var(--faint);
}
.mockbar a[aria-current="true"]{color:var(--fg);border-color:var(--fg)}
`
