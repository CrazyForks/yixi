/**
 * The one list of URL schemes 一息 refuses to hand to `location.href`.
 *
 * Three places need it and they are not interchangeable: /settings rejects a bad
 * scheme at write time, /probe greys it out before the owner taps it, and
 * breathe.ts drops it at the sink — the only one of the three that a scheme
 * inserted straight into D1 (as the README's bootstrap does) still has to pass.
 * Kept in one module because three hand-maintained copies had already drifted:
 * `about:` was in two of them and missing from the one closest to the sink.
 */
export const FORBIDDEN_SCHEMES = ['javascript', 'data', 'vbscript', 'blob', 'file', 'about'] as const

const BANNED = new Set<string>(FORBIDDEN_SCHEMES)

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

// Control characters, whitespace, quotes and angle brackets have no business in
// a URL scheme and are the usual ingredients of an escape attempt.
const UNSAFE_CHARS = /[\u0000-\u0020\u007f"'<>\\]/

/** Returns the scheme unchanged, or '' if it must not be navigated to. */
export function safeScheme(raw: string): string {
  const s = raw.trim()
  if (!SCHEME_RE.test(s)) return ''
  if (UNSAFE_CHARS.test(s)) return ''
  const proto = s.slice(0, s.indexOf(':')).toLowerCase()
  return BANNED.has(proto) ? '' : s
}

/** `javascript:`-style prefixes, for the write-time check in /settings. */
export function forbiddenPrefixes(): string[] {
  return FORBIDDEN_SCHEMES.map((s) => `${s}:`)
}

/** Source for the client-side denylist regex inlined into /probe. */
export function forbiddenSchemePattern(): string {
  return `^(${FORBIDDEN_SCHEMES.join('|')}):`
}
