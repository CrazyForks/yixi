// In-app browsers, and why 「试跳」 cannot work inside one.
//
// A custom URL scheme is opened the only way iOS honours it: `location.href`
// assigned synchronously inside a click handler. In Safari that hands control
// to the target app. Inside an app's own embedded browser it usually does
// nothing at all — WeChat in particular blocks navigation to schemes outside
// its own allowlist, silently. Nothing on our side can change that; it is the
// host app's policy, not a WebKit limitation and not a bug in the scheme.
//
// The failure is silent, and that is the whole problem: the reader taps 试跳,
// nothing happens, and the only available conclusion is 「我填的 scheme 不对」.
// They then work through every candidate in the list, all of which fail for the
// same reason that has nothing to do with any of them. So this exists to say so
// BEFORE the first tap.
//
// What this does NOT affect: the interception itself. The Shortcut's 「打开
// URL」 opens the system default browser, so the breathing page and its 「继续」
// never run inside WeChat. Somebody who configures everything in Safari and
// then only ever shares the link through WeChat has a working setup.
//
// Two deliberate limits:
//
//   - The list is high-confidence tokens only. A false positive tells a Safari
//     user their working button is broken, which is worse than saying nothing,
//     so anything ambiguous is left out. `MQQBrowser` (a standalone browser
//     that does allow the jump) must not be caught by the QQ rule, which is why
//     that one matches `QQ/` rather than `QQ`.
//   - The list is not exhaustive and cannot be. There will always be an
//     embedded browser nobody here has heard of, so the docs carry an
//     unconditional sentence about needing the system browser, and this only
//     adds a specific warning when it can be specific.

export interface InAppBrowser {
  /** What to call it, in the reader's words. */
  name: string
  /** How to get out of it and into the system browser, on iOS. */
  escape: string
}

/**
 * Ordered: the first match wins, so a more specific token has to come before a
 * more general one that could also match the same UA.
 */
const HOSTS: Array<{ token: RegExp; browser: InAppBrowser }> = [
  {
    token: /MicroMessenger/i,
    browser: { name: '微信', escape: '点右上角「⋯」→「在浏览器中打开」' },
  },
  {
    token: /AlipayClient/i,
    browser: { name: '支付宝', escape: '点右上角「⋯」→「在浏览器打开」' },
  },
  {
    token: /DingTalk/i,
    browser: { name: '钉钉', escape: '点右上角「⋯」→「在浏览器中打开」' },
  },
  {
    token: /\bLark\//i,
    browser: { name: '飞书', escape: '点右上角「⋯」→「用默认浏览器打开」' },
  },
  {
    token: /XiaoHongShu|\bxhsdiscover\b/i,
    browser: { name: '小红书', escape: '点右上角分享 →「用浏览器打开」' },
  },
  {
    token: /\bWeibo\b/i,
    browser: { name: '微博', escape: '点右上角「⋯」→「在 Safari 中打开」' },
  },
  // Must stay after nothing in particular, but must not match MQQBrowser —
  // hence the slash. The QQ app's UA carries `QQ/8.9.x`; QQ Browser's does not.
  {
    token: /\bQQ\/[\d.]/i,
    browser: { name: 'QQ', escape: '点右上角「⋯」→「在浏览器中打开」' },
  },
]

/** The host app whose embedded browser this is, or null for a real browser. */
export function detectInAppBrowser(userAgent: string | null): InAppBrowser | null {
  if (userAgent === null || userAgent === '') return null
  for (const { token, browser } of HOSTS) {
    if (token.test(userAgent)) return browser
  }
  return null
}

/** Convenience for a route handler that has the Request but not the header. */
export function inAppBrowserOf(request: Request): InAppBrowser | null {
  return detectInAppBrowser(request.headers.get('user-agent'))
}

/**
 * The same token list as one regex source, for the inline script on the landing
 * page — which stays edge-cacheable and so cannot vary its HTML on the header.
 *
 * Generated rather than retyped: two copies of a list like this drift, and this
 * project has already paid for that once with the scheme denylist.
 */
export function inAppBrowserPattern(): string {
  return HOSTS.map((h) => h.token.source).join('|')
}
