// The three things that turn "a website" into "an icon on the phone": a
// manifest, a touch icon, and the meta that asks for a standalone window.
//
// Served by the Worker rather than as static assets because the Worker has no
// asset binding and the Pages deployment's `public/` is empty on purpose (one
// catch-all Function). Two routes, both public, both cacheable — nothing here
// is per-user.
//
// The icon is a base64 constant, generated once by scripts/icon.mjs. It is the
// only binary in the codebase; keeping it inline is what keeps "zero external
// requests, zero runtime dependencies" true for the home-screen path too.

const PAPER = '#f3f0e8'

/** Six lines every page carries. layout.ts inlines this into <head>. */
export const PWA_HEAD = `<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="一息">
<meta name="apple-mobile-web-app-status-bar-style" content="default">`

const MANIFEST = JSON.stringify({
  name: '一息',
  short_name: '一息',
  // `scope` is not optional on iOS: without it every in-app link opens Safari.
  start_url: '/today',
  scope: '/',
  display: 'standalone',
  background_color: PAPER,
  theme_color: PAPER,
  lang: 'zh-Hans',
  icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
})

const DAY = 'public, max-age=86400'

export function manifestResponse(): Response {
  return new Response(MANIFEST, {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': DAY },
  })
}

/** Output of `node scripts/icon.mjs`. Regenerate there; never hand-edit. */
const ICON_PNG_BASE64 = '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'

let iconBytes: Uint8Array | null = null
function icon(): Uint8Array {
  if (iconBytes) return iconBytes
  const bin = atob(ICON_PNG_BASE64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  iconBytes = out
  return out
}

export function iconResponse(): Response {
  return new Response(icon(), { headers: { 'content-type': 'image/png', 'cache-control': DAY } })
}
