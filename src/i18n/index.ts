/**
 * The translation layer: which language a request should render in, and how
 * to render a string once that is decided.
 *
 * There is one language pair today — 'zh', the language every screen was
 * originally written in, and 'en', a lookup table in en.ts keyed by the
 * Chinese source text itself. A translator is built fresh per request rather
 * than held in a module-level variable: one Worker isolate serves many
 * concurrent requests, and a "current language" global would leak between
 * them.
 */

import { EN } from './en'

export type Locale = 'zh' | 'en'

/** The cookie a signed-out visitor's language choice survives in. */
export const LANG_COOKIE = 'yixi_lang'

/** One year — the same lifetime `langCookie` writes into `Max-Age`. */
const LANG_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export type T = (source: string, params?: Record<string, string | number>) => string

export function isLocale(x: string | null): x is Locale {
  return x === 'zh' || x === 'en'
}

/**
 * Fills `{name}` placeholders from `params`. A name with no matching key is
 * left exactly as written — a missing param must never make half a sentence
 * disappear.
 */
function fillParams(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  )
}

/**
 * `source` is always the Chinese original — it is both what zh renders
 * verbatim and the key en looks itself up by. zh never consults the
 * dictionary: the source *is* the output, placeholders filled in. en looks up
 * `EN[source]` and, when that is missing, falls back to the Chinese source
 * exactly as zh would — a string nobody has translated yet degrades to "the
 * wrong language" rather than "blank".
 */
export function translator(loc: Locale): T {
  if (loc === 'zh') return (source, params) => fillParams(source, params)
  return (source, params) => fillParams(EN[source] ?? source, params)
}

/**
 * Identity marker for a Chinese message built outside a page — today only
 * src/account.ts's user-facing error strings — that some page later wraps in
 * `t()` once it turns the message into a response. `msg` performs no
 * translation itself; it exists purely so test/i18n.test.ts's guard can grep
 * for it as reliably as it greps for `t(`, and so the string reads as
 * "destined for the UI" at the point it is written, not buried in a module
 * the guard would otherwise never look at.
 */
export function msg(source: string): string {
  return source
}

/** Set-Cookie value for a language choice: one year, SameSite=Lax, Path=/. */
export function langCookie(loc: Locale): string {
  return `${LANG_COOKIE}=${loc}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE_SECONDS}`
}

export function htmlLang(loc: Locale): 'zh-Hans' | 'en' {
  return loc === 'en' ? 'en' : 'zh-Hans'
}

/** Reads a single cookie by name without pulling in src/auth.ts — this module
 * stays dependency-free so anything (including auth.ts and db.ts) can import
 * it without risking a cycle. */
function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/** First tag of Accept-Language ("zh-CN,zh;q=0.9" -> "zh-CN"), or null. */
function firstAcceptLanguageTag(header: string | null): string | null {
  if (!header) return null
  const first = header.split(',')[0]
  if (!first) return null
  const tag = first.split(';')[0] ?? ''
  const trimmed = tag.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Five-level precedence, most specific first:
 *
 *   1. `?lang=` on this very request — an explicit, one-off choice.
 *   2. `user.locale` — what a signed-in account has settled on.
 *   3. the `yixi_lang` cookie — what a signed-out browser last chose.
 *   4. `Accept-Language` — the browser's own setting, honoured only as a
 *      tie-breaker with nothing more specific to go on.
 *   5. 'zh' — the source language, and the answer when a request carries no
 *      language information at all (the existing test suite's baseline).
 *
 * `user.locale` is optional because `User.locale` in src/types.ts is
 * (`string | null` for rows that have chosen one, but the property itself is
 * optional so every existing `User` literal in the test suite keeps
 * compiling unedited); `undefined` is treated exactly like `null`.
 */
export function localeOf(request: Request, user: { locale?: string | null } | null): Locale {
  const param = new URL(request.url).searchParams.get('lang')
  if (isLocale(param)) return param

  const userLocale = user?.locale
  if (typeof userLocale === 'string' && isLocale(userLocale)) return userLocale

  const cookie = cookieValue(request, LANG_COOKIE)
  if (isLocale(cookie)) return cookie

  const tag = firstAcceptLanguageTag(request.headers.get('Accept-Language'))
  if (tag) return tag.toLowerCase().startsWith('zh') ? 'zh' : 'en'

  return 'zh'
}
